/**
 * popup.js
 * Drives the popup UI: power toggle, live stats, graveyard (recently
 * closed tabs), and the action buttons.
 */

document.addEventListener("DOMContentLoaded", init);

var els = {};

function init() {
  els.powerToggle = document.getElementById("powerToggle");
  els.statusSubtitle = document.getElementById("statusSubtitle");
  els.statKilled = document.getElementById("statKilled");
  els.statSaved = document.getElementById("statSaved");
  els.statOpenTabs = document.getElementById("statOpenTabs");
  els.statBattles = document.getElementById("statBattles");
  els.graveyardList = document.getElementById("graveyardList");
  els.graveyardEmpty = document.getElementById("graveyardEmpty");
  els.forceBattleBtn = document.getElementById("forceBattleBtn");
  els.settingsBtn = document.getElementById("settingsBtn");
  els.toast = document.getElementById("toast");

  loadAll();

  els.powerToggle.addEventListener("change", onPowerToggle);
  els.forceBattleBtn.addEventListener("click", onForceBattle);
  els.settingsBtn.addEventListener("click", onOpenSettings);
}

async function loadAll() {
  await loadConfigAndStatus();
  await loadStats();
  await loadOpenTabCount();
  await loadGraveyard();
  await showPendingAchievementToasts();
}

/**
 * Achievement unlocks are queued by the background worker (no OS
 * notification involved) and shown here the next time the popup opens.
 */
async function showPendingAchievementToasts() {
  var pending = await TBR.getPendingToasts();
  if (!pending || pending.length === 0) return;

  // Only surface the most recent one in this tiny popup; clear the queue
  // either way so it doesn't grow unbounded.
  var latest = pending[pending.length - 1];
  showToast(latest.title + " — " + latest.message, false);
  await TBR.setPendingToasts([]);
}

async function loadConfigAndStatus() {
  var config = await TBR.getConfig();
  els.powerToggle.checked = !!config.enabled;
  updateStatusSubtitle(config.enabled);
}

function updateStatusSubtitle(enabled) {
  els.statusSubtitle.textContent = enabled
    ? "Hunting inactive tabs..."
    : "Ceasefire — extension paused.";
}

async function loadStats() {
  var stats = await TBR.getStats();
  els.statKilled.textContent = stats.killed;
  els.statSaved.textContent = stats.saved;
  els.statBattles.textContent = stats.battles;
}

async function loadOpenTabCount() {
  try {
    var tabs = await chrome.tabs.query({});
    els.statOpenTabs.textContent = tabs.length;
  } catch (e) {
    els.statOpenTabs.textContent = "?";
  }
}

async function loadGraveyard() {
  try {
    var sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 5 });
    var tabSessions = sessions.filter(function (s) {
      return !!s.tab;
    });

    els.graveyardList.querySelectorAll(".graveyard__item").forEach(function (node) {
      node.remove();
    });

    if (tabSessions.length === 0) {
      els.graveyardEmpty.style.display = "block";
      return;
    }

    els.graveyardEmpty.style.display = "none";

    tabSessions.forEach(function (session) {
      var tab = session.tab;
      var li = document.createElement("li");
      li.className = "graveyard__item";

      var titleSpan = document.createElement("span");
      titleSpan.className = "graveyard__title";
      titleSpan.textContent = tab.title || tab.url || "Unknown tab";
      titleSpan.title = tab.url || "";

      var reviveBtn = document.createElement("button");
      reviveBtn.className = "graveyard__revive";
      reviveBtn.textContent = "↺ Revive";
      reviveBtn.addEventListener("click", function () {
        reviveTab(tab.sessionId, reviveBtn);
      });

      li.appendChild(titleSpan);
      li.appendChild(reviveBtn);
      els.graveyardList.appendChild(li);
    });
  } catch (e) {
    console.error("Tab Battle Royale: failed to load graveyard", e);
  }
}

async function reviveTab(sessionId, buttonEl) {
  buttonEl.disabled = true;
  buttonEl.textContent = "...";
  try {
    await chrome.sessions.restore(sessionId);
    showToast("Tab revived from the graveyard.", false);
    await loadGraveyard();
    await loadOpenTabCount();
  } catch (e) {
    console.error("Tab Battle Royale: revive failed", e);
    showToast("Couldn't revive that tab.", true);
    buttonEl.disabled = false;
    buttonEl.textContent = "↺ Revive";
  }
}

async function onPowerToggle() {
  var enabled = els.powerToggle.checked;
  var config = await TBR.getConfig();
  config.enabled = enabled;
  await TBR.setConfig(config);
  updateStatusSubtitle(enabled);
  showToast(enabled ? "Tab Battle Royale is now active." : "Tab Battle Royale paused.", false);
}

async function onForceBattle() {
  els.forceBattleBtn.disabled = true;
  var originalText = els.forceBattleBtn.textContent;
  els.forceBattleBtn.textContent = "Engaging...";

  chrome.runtime.sendMessage({ type: "FORCE_BATTLE" }, function (response) {
    els.forceBattleBtn.disabled = false;
    els.forceBattleBtn.textContent = originalText;

    if (chrome.runtime.lastError) {
      showToast("Background worker unavailable — try again.", true);
      return;
    }
    if (response && response.ok) {
      showToast("Battle window opened for the current tab.", false);
    } else {
      showToast((response && response.error) || "Could not start a battle.", true);
    }
  });
}

function onOpenSettings() {
  chrome.runtime.openOptionsPage();
}

var toastTimer = null;
function showToast(message, isError) {
  els.toast.textContent = message;
  els.toast.classList.toggle("toast--error", !!isError);
  els.toast.classList.add("toast--visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    els.toast.classList.remove("toast--visible");
  }, 2600);
}
