/**
 * options.js
 * Loads and saves configuration (including the Hours/Minutes/Seconds
 * duration pickers), and renders the achievements grid based on current
 * stats.
 */

document.addEventListener("DOMContentLoaded", init);

var els = {};

function init() {
  els.inactiveHours = document.getElementById("inactiveHours");
  els.inactiveMinutes = document.getElementById("inactiveMinutes");
  els.inactiveSeconds = document.getElementById("inactiveSeconds");
  els.countdownHours = document.getElementById("countdownHours");
  els.countdownMinutes = document.getElementById("countdownMinutes");
  els.countdownSeconds = document.getElementById("countdownSeconds");
  els.ignorePinned = document.getElementById("ignorePinned");
  els.ignoreMedia = document.getElementById("ignoreMedia");
  els.ignoreMuted = document.getElementById("ignoreMuted");
  els.achievementsEnabled = document.getElementById("achievementsEnabled");
  els.whitelist = document.getElementById("whitelist");
  els.blacklist = document.getElementById("blacklist");
  els.achievementsGrid = document.getElementById("achievementsGrid");
  els.achievementProgress = document.getElementById("achievementProgress");
  els.saveBtn = document.getElementById("saveBtn");
  els.saveIndicator = document.getElementById("saveIndicator");
  els.resetStatsBtn = document.getElementById("resetStatsBtn");

  loadSettings();
  loadAchievements();

  els.saveBtn.addEventListener("click", saveSettings);
  els.resetStatsBtn.addEventListener("click", resetStats);
}

async function loadSettings() {
  var config = await TBR.getConfig();

  var inactiveParts = TBR.fromTotalSeconds(config.inactiveThresholdSeconds);
  els.inactiveHours.value = inactiveParts.hours;
  els.inactiveMinutes.value = inactiveParts.minutes;
  els.inactiveSeconds.value = inactiveParts.seconds;

  var countdownParts = TBR.fromTotalSeconds(config.countdownSeconds);
  els.countdownHours.value = countdownParts.hours;
  els.countdownMinutes.value = countdownParts.minutes;
  els.countdownSeconds.value = countdownParts.seconds;

  els.ignorePinned.checked = !!config.ignorePinned;
  els.ignoreMedia.checked = !!config.ignoreMedia;
  els.ignoreMuted.checked = !!config.ignoreMuted;
  els.achievementsEnabled.checked = !!config.achievementsEnabled;
  els.whitelist.value = (config.whitelist || []).join("\n");
  els.blacklist.value = (config.blacklist || []).join("\n");
}

async function saveSettings() {
  var config = await TBR.getConfig();

  var inactiveTotal = TBR.toTotalSeconds(els.inactiveHours.value, els.inactiveMinutes.value, els.inactiveSeconds.value);
  var countdownTotal = TBR.toTotalSeconds(els.countdownHours.value, els.countdownMinutes.value, els.countdownSeconds.value);

  config.inactiveThresholdSeconds = Math.max(TBR.MIN_INACTIVE_THRESHOLD_SECONDS, inactiveTotal || TBR.DEFAULT_CONFIG.inactiveThresholdSeconds);
  config.countdownSeconds = Math.max(TBR.MIN_COUNTDOWN_SECONDS, countdownTotal || TBR.DEFAULT_CONFIG.countdownSeconds);
  config.ignorePinned = els.ignorePinned.checked;
  config.ignoreMedia = els.ignoreMedia.checked;
  config.ignoreMuted = els.ignoreMuted.checked;
  config.achievementsEnabled = els.achievementsEnabled.checked;
  config.whitelist = TBR.parseDomainList(els.whitelist.value);
  config.blacklist = TBR.parseDomainList(els.blacklist.value);

  await TBR.setConfig(config);

  // Reflect the sanitized/clamped values back into the fields so the user
  // sees exactly what was persisted.
  var inactiveParts = TBR.fromTotalSeconds(config.inactiveThresholdSeconds);
  els.inactiveHours.value = inactiveParts.hours;
  els.inactiveMinutes.value = inactiveParts.minutes;
  els.inactiveSeconds.value = inactiveParts.seconds;

  var countdownParts = TBR.fromTotalSeconds(config.countdownSeconds);
  els.countdownHours.value = countdownParts.hours;
  els.countdownMinutes.value = countdownParts.minutes;
  els.countdownSeconds.value = countdownParts.seconds;

  els.whitelist.value = config.whitelist.join("\n");
  els.blacklist.value = config.blacklist.join("\n");

  flashSaveIndicator();
}

function flashSaveIndicator() {
  els.saveIndicator.classList.add("save-indicator--visible");
  clearTimeout(flashSaveIndicator._t);
  flashSaveIndicator._t = setTimeout(function () {
    els.saveIndicator.classList.remove("save-indicator--visible");
  }, 1800);
}

async function loadAchievements() {
  var stats = await TBR.getStats();
  var unlocked = await TBR.getUnlockedAchievements();

  els.achievementsGrid.innerHTML = "";
  var unlockedCount = 0;

  TBR.ACHIEVEMENTS.forEach(function (achievement) {
    var isUnlocked = !!unlocked[achievement.id] || achievement.check(stats);
    if (isUnlocked) unlockedCount += 1;

    var card = document.createElement("div");
    card.className = "achievement" + (isUnlocked ? " achievement--unlocked" : "");

    var icon = document.createElement("span");
    icon.className = "achievement__icon";
    icon.textContent = achievement.icon;

    var text = document.createElement("div");
    var name = document.createElement("p");
    name.className = "achievement__name";
    name.textContent = achievement.name;
    var desc = document.createElement("p");
    desc.className = "achievement__desc";
    desc.textContent = achievement.description;

    text.appendChild(name);
    text.appendChild(desc);
    card.appendChild(icon);
    card.appendChild(text);
    els.achievementsGrid.appendChild(card);
  });

  els.achievementProgress.textContent = unlockedCount + " / " + TBR.ACHIEVEMENTS.length + " unlocked";
}

async function resetStats() {
  var confirmed = window.confirm("Reset Tabs Killed, Tabs Saved, and Total Battles back to zero? This cannot be undone.");
  if (!confirmed) return;

  await TBR.setStats(Object.assign({}, TBR.DEFAULT_STATS));
  await TBR.setUnlockedAchievements({});
  await loadAchievements();
  flashSaveIndicator();
}
