/**
 * background.js
 * Service worker for Tab Battle Royale.
 *
 * - Runs a minute-by-minute chrome.alarms sweep over open tabs.
 * - Picks one eligible inactive tab at a time and opens a small in-browser
 *   "battle" popup window (battle.html) with a live countdown and two
 *   action buttons — no OS-level chrome.notifications involved.
 * - Resolves each battle exactly once (save / kill / timeout / dismiss),
 *   updating stats and achievements in chrome.storage.local.
 */

importScripts("utils.js");

var CHECK_ALARM_NAME = "tbr_check_tabs";
var BATTLE_WINDOW_WIDTH = 420;
var BATTLE_WINDOW_HEIGHT = 400;

// ---------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(function () {
  initializeDefaults();
  chrome.alarms.create(CHECK_ALARM_NAME, { periodInMinutes: 1 });
  resetTabActivityToCurrentTabs();
});

chrome.runtime.onStartup.addListener(function () {
  chrome.alarms.create(CHECK_ALARM_NAME, { periodInMinutes: 1 });
  resetTabActivityToCurrentTabs();
});

async function initializeDefaults() {
  var config = await TBR.getConfig();
  await TBR.setConfig(config);
  var stats = await TBR.getStats();
  await TBR.setStats(stats);
}

/**
 * Rebuilds the tab-activity map from scratch using only the tabs that are
 * actually open right now.
 *
 * This matters because Chrome can and does reuse tab IDs across browser
 * restarts. If we only ever merged new tabs into the old activity map
 * (instead of resetting it), a freshly opened tab could inherit a
 * years-old timestamp left behind by a *different* tab that used to have
 * the same ID — making it look ancient and eligible for battle the moment
 * it opened. Resetting on every browser startup (and on install) removes
 * that stale-ID collision entirely.
 */
async function resetTabActivityToCurrentTabs() {
  try {
    var tabs = await chrome.tabs.query({});
    var now = Date.now();
    var freshActivity = {};
    tabs.forEach(function (tab) {
      freshActivity[tab.id] = now;
    });
    await TBR.setTabActivity(freshActivity);

    // Also drop any battle records left over from a previous session —
    // their windows no longer exist.
    await TBR.setActiveBattles({});
  } catch (e) {
    console.error("Tab Battle Royale: failed to reset tab activity", e);
  }
}

// ---------------------------------------------------------------------
// Tab activity tracking
// ---------------------------------------------------------------------

chrome.tabs.onCreated.addListener(async function (tab) {
  try {
    var activity = await TBR.getTabActivity();
    activity[tab.id] = Date.now();
    await TBR.setTabActivity(activity);
  } catch (e) {
    console.error("Tab Battle Royale: onCreated activity update failed", e);
  }
});

chrome.tabs.onActivated.addListener(async function (activeInfo) {
  try {
    var activity = await TBR.getTabActivity();
    activity[activeInfo.tabId] = Date.now();
    await TBR.setTabActivity(activity);
  } catch (e) {
    console.error("Tab Battle Royale: onActivated activity update failed", e);
  }
});

chrome.tabs.onRemoved.addListener(async function (tabId) {
  try {
    var activity = await TBR.getTabActivity();
    delete activity[tabId];
    await TBR.setTabActivity(activity);
  } catch (e) {
    console.error("Tab Battle Royale: onRemoved activity cleanup failed", e);
  }

  // If a battle was in progress for this tab and the user manually closed
  // it out from under the battle window, resolve that battle as a kill so
  // stats stay consistent, without trying to remove the (already gone) tab.
  try {
    var battles = await TBR.getActiveBattles();
    for (var battleId in battles) {
      if (battles[battleId].tabId === tabId && !battles[battleId].resolved) {
        await resolveBattle(battleId, "kill", { skipTabRemoval: true });
      }
    }
  } catch (e) {
    console.error("Tab Battle Royale: onRemoved battle cleanup failed", e);
  }
});

// If the user closes the battle popup window itself (the "X" button)
// without clicking Save or Delete, that's a manual dismissal — the tab
// loses.
chrome.windows.onRemoved.addListener(async function (windowId) {
  try {
    var battles = await TBR.getActiveBattles();
    for (var battleId in battles) {
      if (battles[battleId].windowId === windowId && !battles[battleId].resolved) {
        await resolveBattle(battleId, "dismiss");
      }
    }
  } catch (e) {
    console.error("Tab Battle Royale: windows.onRemoved handling failed", e);
  }
});

// ---------------------------------------------------------------------
// Alarm sweep
// ---------------------------------------------------------------------

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name === CHECK_ALARM_NAME) {
    cleanupExpiredBattles()
      .then(pruneStaleTabActivity)
      .then(runBattleCheck);
  }
});

async function cleanupExpiredBattles() {
  try {
    var battles = await TBR.getActiveBattles();
    var now = Date.now();
    var ids = Object.keys(battles);
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var battle = battles[id];
      // A small grace buffer accounts for the battle window's own timer
      // firing a second or two late; the alarm is purely a backstop.
      if (!battle.resolved && battle.expiresAt + 5000 <= now) {
        await resolveBattle(id, "timeout");
      }
    }
  } catch (e) {
    console.error("Tab Battle Royale: cleanupExpiredBattles failed", e);
  }
}

/**
 * Removes tab-activity entries for tabs that no longer exist, so stale
 * IDs never have a chance to collide with a reused ID down the line.
 */
async function pruneStaleTabActivity() {
  try {
    var tabs = await chrome.tabs.query({});
    var liveIds = {};
    tabs.forEach(function (tab) {
      liveIds[tab.id] = true;
    });
    var activity = await TBR.getTabActivity();
    var changed = false;
    Object.keys(activity).forEach(function (tabId) {
      if (!liveIds[tabId]) {
        delete activity[tabId];
        changed = true;
      }
    });
    if (changed) {
      await TBR.setTabActivity(activity);
    }
  } catch (e) {
    console.error("Tab Battle Royale: pruneStaleTabActivity failed", e);
  }
}

async function runBattleCheck() {
  try {
    var config = await TBR.getConfig();
    if (!config.enabled) return;

    var battles = await TBR.getActiveBattles();
    var hasActiveBattle = Object.keys(battles).some(function (id) {
      return !battles[id].resolved;
    });
    if (hasActiveBattle) return; // one battle at a time

    var tabs = await chrome.tabs.query({});
    var activity = await TBR.getTabActivity();
    var now = Date.now();

    var candidates = [];
    tabs.forEach(function (tab) {
      var evalResult = evaluateEligibility(tab, config, activity, now);
      if (evalResult.eligible) {
        candidates.push({
          tab: tab,
          isBlacklisted: evalResult.isBlacklisted,
          secondsInactive: evalResult.secondsInactive
        });
      }
    });

    if (candidates.length === 0) return;

    // Prioritize blacklisted tabs, then the longest-idle tab.
    candidates.sort(function (a, b) {
      if (a.isBlacklisted !== b.isBlacklisted) {
        return a.isBlacklisted ? -1 : 1;
      }
      return b.secondsInactive - a.secondsInactive;
    });

    await startBattle(candidates[0].tab, config);
  } catch (e) {
    console.error("Tab Battle Royale: runBattleCheck failed", e);
  }
}

function evaluateEligibility(tab, config, activity, now) {
  if (tab.active) return { eligible: false };
  if (config.ignorePinned && tab.pinned) return { eligible: false };
  if (config.ignoreMedia && tab.audible) return { eligible: false };
  if (config.ignoreMuted && tab.mutedInfo && tab.mutedInfo.muted) return { eligible: false };

  var hostname = TBR.getHostname(tab.url || "");
  if (TBR.hostnameMatchesList(hostname, config.whitelist)) return { eligible: false };

  // If we have no recorded activity for this tab (shouldn't normally
  // happen — onCreated/reset should always seed it), treat it as freshly
  // active rather than assuming it's ancient. This is the same
  // fail-safe direction as the startup reset: when in doubt, don't kill.
  var lastActive = Object.prototype.hasOwnProperty.call(activity, tab.id) ? activity[tab.id] : now;
  var secondsInactive = (now - lastActive) / 1000;
  var isBlacklisted = TBR.hostnameMatchesList(hostname, config.blacklist);
  var threshold = isBlacklisted
    ? Math.max(TBR.MIN_INACTIVE_THRESHOLD_SECONDS, config.inactiveThresholdSeconds / 2)
    : config.inactiveThresholdSeconds;

  return {
    eligible: secondsInactive >= threshold,
    isBlacklisted: isBlacklisted,
    secondsInactive: secondsInactive
  };
}

// ---------------------------------------------------------------------
// Battle lifecycle
// ---------------------------------------------------------------------

async function startBattle(tab, config) {
  var battleId = "battle_" + tab.id + "_" + Date.now();
  var roast = TBR.pickRandomRoast();
  var countdownSeconds = Math.max(TBR.MIN_COUNTDOWN_SECONDS, config.countdownSeconds);
  var expiresAt = Date.now() + countdownSeconds * 1000;
  var title = tab.title && tab.title.length > 70 ? tab.title.slice(0, 67) + "..." : tab.title || "Untitled Tab";

  var battle = {
    tabId: tab.id,
    tabTitle: title,
    tabUrl: tab.url || "",
    roast: roast,
    expiresAt: expiresAt,
    countdownSeconds: countdownSeconds,
    windowId: null,
    resolved: false
  };

  var battles = await TBR.getActiveBattles();
  battles[battleId] = battle;
  await TBR.setActiveBattles(battles);

  var battleUrl = chrome.runtime.getURL("battle.html") + "?battleId=" + encodeURIComponent(battleId);

  try {
    var win = await chrome.windows.create({
      url: battleUrl,
      type: "popup",
      width: BATTLE_WINDOW_WIDTH,
      height: BATTLE_WINDOW_HEIGHT,
      focused: true
    });

    var refreshedBattles = await TBR.getActiveBattles();
    if (refreshedBattles[battleId]) {
      refreshedBattles[battleId].windowId = win.id;
      await TBR.setActiveBattles(refreshedBattles);
    }
  } catch (e) {
    console.error("Tab Battle Royale: failed to open battle window", e);
    // If we couldn't even show the battle window, don't leave the tab in
    // limbo — just drop the battle record and try again next sweep.
    var cleanupBattles = await TBR.getActiveBattles();
    delete cleanupBattles[battleId];
    await TBR.setActiveBattles(cleanupBattles);
  }
}

/**
 * Resolves a battle exactly once. outcome is one of:
 *   "save"    - user clicked Go to Tab & Save
 *   "kill"    - user clicked Delete Now
 *   "timeout" - countdown expired with no response
 *   "dismiss" - user closed the battle popup window without choosing
 */
async function resolveBattle(battleId, outcome, options) {
  options = options || {};
  var battles = await TBR.getActiveBattles();
  var battle = battles[battleId];
  if (!battle || battle.resolved) return;

  battle.resolved = true;
  battles[battleId] = battle;
  await TBR.setActiveBattles(battles);

  // Close the battle window if it's still open (e.g. we're resolving via
  // the timeout backstop rather than a user action inside the window).
  if (battle.windowId !== null && battle.windowId !== undefined) {
    try {
      await chrome.windows.remove(battle.windowId);
    } catch (e) {
      // Already closed by the user — fine.
    }
  }

  var stats = await TBR.getStats();
  var activity = await TBR.getTabActivity();

  if (outcome === "save") {
    try {
      var tab = await chrome.tabs.get(battle.tabId);
      await chrome.tabs.update(battle.tabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    } catch (e) {
      console.warn("Tab Battle Royale: could not focus saved tab (it may have been closed manually)", e);
    }
    activity[battle.tabId] = Date.now();
    stats.saved += 1;
  } else {
    if (!options.skipTabRemoval) {
      try {
        await chrome.tabs.remove(battle.tabId);
      } catch (e) {
        console.warn("Tab Battle Royale: could not close tab (it may have been closed manually already)", e);
      }
    }
    delete activity[battle.tabId];
    stats.killed += 1;
  }
  stats.battles += 1;

  await TBR.setTabActivity(activity);
  await TBR.setStats(stats);

  // Remove the resolved battle record entirely once processed.
  var latestBattles = await TBR.getActiveBattles();
  delete latestBattles[battleId];
  await TBR.setActiveBattles(latestBattles);

  var config = await TBR.getConfig();
  if (config.achievementsEnabled) {
    await TBR.evaluateAchievements(stats); // queues pending toasts for the popup
  }
}

// ---------------------------------------------------------------------
// Messages from popup / options / battle window
// ---------------------------------------------------------------------

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || !message.type) return false;

  if (message.type === "FORCE_BATTLE") {
    forceBattleOnCurrentTab().then(function (result) {
      sendResponse(result);
    });
    return true; // keep the message channel open for the async response
  }

  if (message.type === "RESOLVE_BATTLE") {
    resolveBattle(message.battleId, message.outcome).then(function () {
      sendResponse({ ok: true });
    });
    return true;
  }

  return false;
});

async function forceBattleOnCurrentTab() {
  try {
    var config = await TBR.getConfig();
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) {
      return { ok: false, error: "No active tab found." };
    }
    var battles = await TBR.getActiveBattles();
    var hasActiveBattle = Object.keys(battles).some(function (id) {
      return !battles[id].resolved;
    });
    if (hasActiveBattle) {
      return { ok: false, error: "A battle is already in progress." };
    }
    await startBattle(tabs[0], config);
    return { ok: true };
  } catch (e) {
    console.error("Tab Battle Royale: forceBattleOnCurrentTab failed", e);
    return { ok: false, error: String(e) };
  }
}
