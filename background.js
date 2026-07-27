/**
 * background.js
 * Service worker for Tab Battle Royale.
 *
 * - Runs a minute-by-minute chrome.alarms sweep over open tabs.
 * - Picks one eligible inactive tab at a time and starts a "battle":
 *   a desktop notification with a live countdown and two action buttons.
 * - Resolves each battle exactly once (save / kill / timeout / dismiss),
 *   updating stats and achievements in chrome.storage.local.
 */

importScripts("utils.js");

var CHECK_ALARM_NAME = "tbr_check_tabs";

// In-memory bookkeeping for live countdowns. These are best-effort: if the
// service worker is terminated mid-countdown, the next minute's alarm sweep
// (cleanupExpiredBattles) will detect and resolve any battle whose
// expiresAt has already passed, so no tab battle is left stuck forever.
var battleIntervals = {}; // notificationId -> intervalId (chrome.alarms not used for sub-minute ticks)

// ---------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(function () {
  initializeDefaults();
  chrome.alarms.create(CHECK_ALARM_NAME, { periodInMinutes: 1 });
  seedTabActivityForAllTabs();
});

chrome.runtime.onStartup.addListener(function () {
  chrome.alarms.create(CHECK_ALARM_NAME, { periodInMinutes: 1 });
  seedTabActivityForAllTabs();
});

async function initializeDefaults() {
  var config = await TBR.getConfig();
  await TBR.setConfig(config);
  var stats = await TBR.getStats();
  await TBR.setStats(stats);
}

async function seedTabActivityForAllTabs() {
  try {
    var tabs = await chrome.tabs.query({});
    var activity = await TBR.getTabActivity();
    var now = Date.now();
    tabs.forEach(function (tab) {
      if (!(tab.id in activity)) {
        activity[tab.id] = now;
      }
    });
    await TBR.setTabActivity(activity);
  } catch (e) {
    console.error("Tab Battle Royale: failed to seed tab activity", e);
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
  // it out from under the notification, resolve that battle as a kill so
  // stats stay consistent, without trying to remove the (already gone) tab.
  try {
    var battles = await TBR.getActiveBattles();
    for (var notificationId in battles) {
      if (battles[notificationId].tabId === tabId && !battles[notificationId].resolved) {
        await resolveBattle(notificationId, "kill", { skipTabRemoval: true });
      }
    }
  } catch (e) {
    console.error("Tab Battle Royale: onRemoved battle cleanup failed", e);
  }
});

// ---------------------------------------------------------------------
// Alarm sweep
// ---------------------------------------------------------------------

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name === CHECK_ALARM_NAME) {
    cleanupExpiredBattles().then(runBattleCheck);
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
      if (!battle.resolved && battle.expiresAt <= now) {
        await resolveBattle(id, "timeout");
      }
    }
  } catch (e) {
    console.error("Tab Battle Royale: cleanupExpiredBattles failed", e);
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
        candidates.push({ tab: tab, isBlacklisted: evalResult.isBlacklisted, minutesInactive: evalResult.minutesInactive });
      }
    });

    if (candidates.length === 0) return;

    // Prioritize blacklisted tabs, then the longest-idle tab.
    candidates.sort(function (a, b) {
      if (a.isBlacklisted !== b.isBlacklisted) {
        return a.isBlacklisted ? -1 : 1;
      }
      return b.minutesInactive - a.minutesInactive;
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

  var lastActive = activity[tab.id] || now;
  var minutesInactive = (now - lastActive) / 60000;
  var isBlacklisted = TBR.hostnameMatchesList(hostname, config.blacklist);
  var threshold = isBlacklisted ? Math.max(1, config.inactiveMinutes / 2) : config.inactiveMinutes;

  return {
    eligible: minutesInactive >= threshold,
    isBlacklisted: isBlacklisted,
    minutesInactive: minutesInactive
  };
}

// ---------------------------------------------------------------------
// Battle lifecycle
// ---------------------------------------------------------------------

async function startBattle(tab, config) {
  var notificationId = "battle_" + tab.id + "_" + Date.now();
  var roast = TBR.pickRandomRoast();
  var countdownSeconds = TBR.safeParseInt(config.countdownSeconds, TBR.DEFAULT_CONFIG.countdownSeconds);
  var expiresAt = Date.now() + countdownSeconds * 1000;
  var title = tab.title && tab.title.length > 60 ? tab.title.slice(0, 57) + "..." : tab.title || "Untitled Tab";

  var battle = {
    tabId: tab.id,
    tabTitle: title,
    tabUrl: tab.url || "",
    roast: roast,
    expiresAt: expiresAt,
    countdownSeconds: countdownSeconds,
    resolved: false
  };

  var battles = await TBR.getActiveBattles();
  battles[notificationId] = battle;
  await TBR.setActiveBattles(battles);

  await chrome.notifications.create(notificationId, {
    type: "basic",
    iconUrl: TBR.NOTIFICATION_ICON_BASE64,
    title: "⚔️ BATTLE: " + title,
    message: roast + " Respond in " + countdownSeconds + "s or it dies.",
    priority: 2,
    requireInteraction: true,
    buttons: [{ title: "🛡️ Go to Tab & Save" }, { title: "💀 Delete Now" }]
  });

  startCountdownTick(notificationId, countdownSeconds);
}

// Runs an in-memory 1-second tick loop that live-updates the notification
// text with the remaining time, mirroring a strict countdown timer. If the
// service worker is asleep, this loop simply doesn't run — the alarm-based
// cleanupExpiredBattles() sweep is the durable backstop that guarantees the
// tab still dies on schedule.
function startCountdownTick(notificationId, secondsLeft) {
  clearInterval(battleIntervals[notificationId]);
  var remaining = secondsLeft;

  battleIntervals[notificationId] = setInterval(async function () {
    remaining -= 1;

    var battles = await TBR.getActiveBattles();
    var battle = battles[notificationId];
    if (!battle || battle.resolved) {
      clearInterval(battleIntervals[notificationId]);
      delete battleIntervals[notificationId];
      return;
    }

    if (remaining <= 0) {
      clearInterval(battleIntervals[notificationId]);
      delete battleIntervals[notificationId];
      await resolveBattle(notificationId, "timeout");
      return;
    }

    try {
      await chrome.notifications.update(notificationId, {
        message: battle.roast + " Respond in " + remaining + "s or it dies."
      });
    } catch (e) {
      // Notification may already be gone; the timeout branch above will
      // still fire and resolve the battle safely.
    }
  }, 1000);
}

/**
 * Resolves a battle exactly once. outcome is one of:
 *   "save"    - user clicked Go to Tab & Save
 *   "kill"    - user clicked Delete Now
 *   "timeout" - countdown expired with no response
 *   "dismiss" - user swiped the notification away
 */
async function resolveBattle(notificationId, outcome, options) {
  options = options || {};
  var battles = await TBR.getActiveBattles();
  var battle = battles[notificationId];
  if (!battle || battle.resolved) return;

  battle.resolved = true;
  battles[notificationId] = battle;
  await TBR.setActiveBattles(battles);

  clearInterval(battleIntervals[notificationId]);
  delete battleIntervals[notificationId];

  try {
    await chrome.notifications.clear(notificationId);
  } catch (e) {
    // Already cleared/dismissed — safe to ignore.
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
  delete latestBattles[notificationId];
  await TBR.setActiveBattles(latestBattles);

  var config = await TBR.getConfig();
  if (config.achievementsEnabled) {
    var newlyUnlocked = await TBR.evaluateAchievements(stats);
    newlyUnlocked.forEach(function (achievement) {
      announceAchievement(achievement);
    });
  }
}

function announceAchievement(achievement) {
  var id = "achievement_" + achievement.id + "_" + Date.now();
  chrome.notifications.create(id, {
    type: "basic",
    iconUrl: TBR.NOTIFICATION_ICON_BASE64,
    title: "🏆 Achievement Unlocked: " + achievement.name,
    message: achievement.description,
    priority: 1
  });
}

// ---------------------------------------------------------------------
// Notification interaction handlers
// ---------------------------------------------------------------------

chrome.notifications.onButtonClicked.addListener(function (notificationId, buttonIndex) {
  var outcome = buttonIndex === 0 ? "save" : "kill";
  resolveBattle(notificationId, outcome);
});

chrome.notifications.onClosed.addListener(function (notificationId, byUser) {
  if (byUser) {
    // Manual dismissal (swipe away) counts as a loss for the tab.
    resolveBattle(notificationId, "dismiss");
  }
});

// ---------------------------------------------------------------------
// Messages from popup / options (e.g. "Force Battle Now")
// ---------------------------------------------------------------------

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message && message.type === "FORCE_BATTLE") {
    forceBattleOnCurrentTab().then(function (result) {
      sendResponse(result);
    });
    return true; // keep the message channel open for the async response
  }

  if (message && message.type === "TOGGLE_ENABLED") {
    TBR.getConfig().then(async function (config) {
      config.enabled = !!message.enabled;
      await TBR.setConfig(config);
      sendResponse({ ok: true, enabled: config.enabled });
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
