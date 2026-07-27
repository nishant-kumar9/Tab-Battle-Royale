/**
 * battle.js
 * Drives the in-browser battle popup window: shows the tab title, a
 * random roast, and a live countdown, then reports the outcome back to
 * the background service worker.
 */

var battleId = null;
var battle = null;
var tickTimer = null;

var els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  els.crestImg = document.getElementById("crestImg");
  els.tabTitle = document.getElementById("tabTitle");
  els.roastText = document.getElementById("roastText");
  els.secondsLeft = document.getElementById("secondsLeft");
  els.timerFill = document.getElementById("timerFill");
  els.saveBtn = document.getElementById("saveBtn");
  els.killBtn = document.getElementById("killBtn");

  els.crestImg.src = TBR.CREST_ICON_BASE64;

  var params = new URLSearchParams(window.location.search);
  battleId = params.get("battleId");

  if (!battleId) {
    showGoneState();
    return;
  }

  var battles = await TBR.getActiveBattles();
  battle = battles[battleId];

  if (!battle || battle.resolved) {
    showGoneState();
    return;
  }

  els.tabTitle.textContent = battle.tabTitle;
  els.roastText.textContent = battle.roast;

  els.saveBtn.addEventListener("click", function () {
    respond("save");
  });
  els.killBtn.addEventListener("click", function () {
    respond("kill");
  });

  tick();
  tickTimer = setInterval(tick, 250);
}

function showGoneState() {
  els.tabTitle.textContent = "This battle has already ended.";
  els.roastText.textContent = "You can close this window.";
  els.saveBtn.disabled = true;
  els.killBtn.disabled = true;
  els.saveBtn.style.display = "none";
  els.killBtn.style.display = "none";
}

function tick() {
  if (!battle) return;
  var msLeft = battle.expiresAt - Date.now();
  var secondsLeft = Math.max(0, Math.ceil(msLeft / 1000));
  var pct = Math.max(0, Math.min(100, (msLeft / (battle.countdownSeconds * 1000)) * 100));

  els.secondsLeft.textContent = secondsLeft;
  els.timerFill.style.width = pct + "%";

  if (msLeft <= 0) {
    clearInterval(tickTimer);
    respond("timeout");
  }
}

function respond(outcome) {
  clearInterval(tickTimer);
  els.saveBtn.disabled = true;
  els.killBtn.disabled = true;

  chrome.runtime.sendMessage({ type: "RESOLVE_BATTLE", battleId: battleId, outcome: outcome }, function () {
    window.close();
  });

  // Safety net: if the background worker is slow to respond (or the
  // message channel silently drops), don't leave the popup stuck open
  // forever.
  setTimeout(function () {
    window.close();
  }, 1500);
}
