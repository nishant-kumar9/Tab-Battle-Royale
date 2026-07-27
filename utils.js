/**
 * utils.js
 * Shared configuration, storage helpers, stats/achievement logic, and constants
 * for Tab Battle Royale. Loaded via <script src="utils.js"> in popup/options,
 * and via importScripts('utils.js') in the background service worker.
 * Exposes everything under the global `TBR` namespace (works for both
 * `window` in pages and `self` in the service worker).
 */
(function (global) {
  "use strict";

  // ---------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------

  // Base64-encoded PNG used for chrome.notifications iconUrl.
  // SVGs are intentionally avoided here — Chrome's notification renderer
  // can crash or silently fail to display SVG icons.
  var NOTIFICATION_ICON_BASE64 =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAFC0lEQVR4nO2dPa4UOxCFz6CnF0KCREb0FvBWAWuGVbAAIjIkEghJhgBZXAZm2j/lqnOq64tAuu2x63zt9u2evgaKoiiKoiiKojgXl52NX1++ue5s/0xcvrzfkpV5oxX6fixlMGuogvfHQoTlBir4eFZEeLbywRU+Bys5TJlTwfMyOhsMzwAVPjej+QwJUOFrMJLT0hqg0Kf7ejF79r/4/mHmsOIJX//9f+q4nvVAlwCj4Vfo+xiV4UgC80tAhb8X6/oeCjBy9lf4PozU+Sg/sxmgwvfFqt4PBeg9+yv8GHrr/ijH5Rmgwo9ltf51HyCIb58+R3cBwAMBvO/6sRTEgzZWzzHfy3NpBrCa/iMKEsXtGC3GvJJD+CVgR0FYuTe2yDGHCsBYkF0cjSlqzGECsBZkB71jiRhziADMBbFmdAzeY3YXgL0glsz23XPMrgIoFMSK1T57jdlNAJWCWGDVV48xuwigVJBVrPu4e8zbBVAryAq7+rZzzFsFUCzILDv79Pz1q21tbxVgZ8eZJFANH3C4BGSXQDl8wGkRmFUC9fABx18Ds0mQIXzA+UZQFgmyhA8E3ApWlyBT+EDQwyBVCbKFDwQ+DlaTIGP4QPAXQlQkyBo+QPCVMHYJMocPEAgA8EqQPXyARACAT4IzhA8QCQDwSHCW8AEyAYB4Cc4UPkAoABAnwdnCB0gFAPwlOGP4ALEAgJ8EZw0fAP6J7sARz1+/Mg/o+t/bn/9of2+n/R/A5eM7s89hDx8QEACwk+D6JOijn1kVQSF8QEQAYE2CnuDvHTMjgkr4APka4JaZws6Ev3K8UviAmADAWIFXwx9tRy18QFAAoK/QVuH3tqcYPiAqAMBVcKa+jCIrAHC/8NZn/6N2lcMHxAUAYgNQDx9IIADwexC7zv7b9jOEDyQRAPANJEv4QCIBgFzBeJFKgGKcVAIwvCyqRhoBsrwa5k0KAbK9HOqJvAC3QVg+z/8bT9vPIIG0AAwBMPRhBVkBHhV+1yxwr11lCSQFYCw4Y596kBOgt9DWs0BPe4oSSAkwWmArCUbaUZNARoDZwq5KMHO8kgQSXwpdLWgLceRJ4ao43z59lng2QS+A5dnUI4Ll2kFBAmoBdk2ll4/v/ghm55+1ZZaAdg3g/bpW9FvJUVAKEPWu3hkloBMg+kXNs0lAJUB0+DM/OwqbBDQCsIS/ckwvTBJQCMAWvsWxR7BIEC4Aa/iWbdyDQQLKrWMtsAwuswS0W8eusCOwrBJQbx07w86gMkpAv3XsCB63XLNJILF1bA9ZXg1Lu3l0lvA9PjPd5tHZwvf47DSbR2cN36MP8ptHZw+/oSyB5NaxTOE3VCWQ2zqWMfyGovBSW8cyh99QE15m61iF8BtKwktsHasUfkNFePqtYxXDbygIT711rHL4DXbhabeOzRB+g1l4yq1jM4XfYBU+/CthtwPPGH6DUfhwAYBfBcgcfoNN+CUBvrZNlwyILoQn1sKv5HBXgMuX95fpVotDvIW/lyfFJaCIY1kAy8tAMc5q/R8K0HsZKAli6K37oxzNLgElgS9W9T4UYGQxWBL4MFLno/zMF4ElwV6s69t9dl9fvrnOfMCL7x9mDiueMBt6z+w99Lv+rASFP72X7roPcHKGBKi7gxqM5DQ8A5QE3IzmsxRmrQl4mD0xl9YANRtwsJKDWYA1G/hjcQKan8Elwn4sZ96tU3jJYEddbouiKIqiKAozfgDN43O5XE3QhQAAAABJRU5ErkJggg==";

  // Storage keys
  var STORAGE_KEYS = {
    CONFIG: "tbr_config",
    STATS: "tbr_stats",
    ACHIEVEMENTS: "tbr_achievements",
    TAB_ACTIVITY: "tbr_tab_activity",
    ACTIVE_BATTLES: "tbr_active_battles"
  };

  // Default configuration
  var DEFAULT_CONFIG = {
    enabled: true,
    inactiveMinutes: 30,
    countdownSeconds: 15,
    ignorePinned: true,
    ignoreMedia: true,
    ignoreMuted: true,
    achievementsEnabled: true,
    whitelist: [], // domains that are NEVER killed
    blacklist: [] // domains that are prioritized / killed sooner
  };

  var DEFAULT_STATS = {
    killed: 0,
    saved: 0,
    battles: 0
  };

  // Funny roasts shown in the notification body. One is chosen at random
  // per battle.
  var ROASTS = [
    "This tab is collecting digital dust.",
    "Even your RAM is embarrassed by this one.",
    "This tab hasn't moved since the last ice age.",
    "Pretty sure this tab is just a screenshot at this point.",
    "This tab peaked three scrolls ago and never recovered.",
    "Nobody's coming back for this one. Let it go.",
    "This tab is basically a museum exhibit now.",
    "Your browser is doing this tab a favor by forgetting it exists.",
    "This tab has more cobwebs than content.",
    "This tab is on life support and you're not the one paying the bill.",
    "This tab thinks it's still relevant. It is not.",
    "This tab has been idle so long it filed for retirement."
  ];

  // Achievement definitions. `check(stats)` returns true when unlocked.
  var ACHIEVEMENTS = [
    {
      id: "first_blood",
      name: "First Blood",
      description: "Close your first tab in battle.",
      icon: "🩸",
      check: function (stats) {
        return stats.killed >= 1;
      }
    },
    {
      id: "tab_savior",
      name: "Tab Savior",
      description: "Save 5 tabs from deletion.",
      icon: "🛡️",
      check: function (stats) {
        return stats.saved >= 5;
      }
    },
    {
      id: "mass_extinction",
      name: "Mass Extinction",
      description: "Close 25 tabs in battle.",
      icon: "☠️",
      check: function (stats) {
        return stats.killed >= 25;
      }
    },
    {
      id: "guardian_angel",
      name: "Guardian Angel",
      description: "Save 25 tabs from deletion.",
      icon: "😇",
      check: function (stats) {
        return stats.saved >= 25;
      }
    },
    {
      id: "centurion",
      name: "Centurion",
      description: "Fight 100 total battles.",
      icon: "⚔️",
      check: function (stats) {
        return stats.battles >= 100;
      }
    },
    {
      id: "warlord",
      name: "Warlord",
      description: "Close 100 tabs in battle.",
      icon: "👑",
      check: function (stats) {
        return stats.killed >= 100;
      }
    }
  ];

  // ---------------------------------------------------------------------
  // Number / string parsing helpers
  // ---------------------------------------------------------------------

  /**
   * Safely parses a positive integer from user input, falling back to a
   * default value when the input is empty, NaN, zero, or negative.
   */
  function safeParseInt(value, fallback) {
    var parsed = parseInt(value, 10);
    if (isNaN(parsed) || parsed <= 0) {
      return fallback;
    }
    return parsed;
  }

  /**
   * Splits a textarea's contents into a clean array of lowercase domains,
   * stripping empty lines, whitespace, and protocol/path noise.
   */
  function parseDomainList(text) {
    if (!text) return [];
    return text
      .split(/[\n,]+/)
      .map(function (line) {
        return line
          .trim()
          .toLowerCase()
          .replace(/^https?:\/\//, "")
          .replace(/\/.*$/, "")
          .replace(/^www\./, "");
      })
      .filter(function (line) {
        return line.length > 0;
      });
  }

  /**
   * Extracts the bare hostname (no "www.") from a tab URL. Returns "" for
   * URLs that can't be parsed (e.g. chrome:// pages).
   */
  function getHostname(url) {
    try {
      var host = new URL(url).hostname.toLowerCase();
      return host.replace(/^www\./, "");
    } catch (e) {
      return "";
    }
  }

  /**
   * Checks whether a hostname matches an entry in a domain list, allowing
   * subdomain matches (e.g. "mail.google.com" matches "google.com").
   */
  function hostnameMatchesList(hostname, list) {
    if (!hostname || !list || list.length === 0) return false;
    for (var i = 0; i < list.length; i++) {
      var entry = list[i];
      if (!entry) continue;
      if (hostname === entry || hostname.endsWith("." + entry)) {
        return true;
      }
    }
    return false;
  }

  function pickRandomRoast() {
    return ROASTS[Math.floor(Math.random() * ROASTS.length)];
  }

  // ---------------------------------------------------------------------
  // Storage helpers (all backed by chrome.storage.local)
  // ---------------------------------------------------------------------

  function getConfig() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(STORAGE_KEYS.CONFIG, function (result) {
        var stored = result[STORAGE_KEYS.CONFIG] || {};
        resolve(Object.assign({}, DEFAULT_CONFIG, stored));
      });
    });
  }

  function setConfig(config) {
    return new Promise(function (resolve) {
      var toStore = {};
      toStore[STORAGE_KEYS.CONFIG] = config;
      chrome.storage.local.set(toStore, function () {
        resolve(config);
      });
    });
  }

  function getStats() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(STORAGE_KEYS.STATS, function (result) {
        var stored = result[STORAGE_KEYS.STATS] || {};
        resolve(Object.assign({}, DEFAULT_STATS, stored));
      });
    });
  }

  function setStats(stats) {
    return new Promise(function (resolve) {
      var toStore = {};
      toStore[STORAGE_KEYS.STATS] = stats;
      chrome.storage.local.set(toStore, function () {
        resolve(stats);
      });
    });
  }

  function getUnlockedAchievements() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(STORAGE_KEYS.ACHIEVEMENTS, function (result) {
        resolve(result[STORAGE_KEYS.ACHIEVEMENTS] || {});
      });
    });
  }

  function setUnlockedAchievements(unlocked) {
    return new Promise(function (resolve) {
      var toStore = {};
      toStore[STORAGE_KEYS.ACHIEVEMENTS] = unlocked;
      chrome.storage.local.set(toStore, function () {
        resolve(unlocked);
      });
    });
  }

  /**
   * Compares current stats against achievement definitions, persists any
   * newly unlocked achievements, and returns the list of newly unlocked
   * achievement objects (empty array if none).
   */
  function evaluateAchievements(stats) {
    return getUnlockedAchievements().then(function (unlocked) {
      var newlyUnlocked = [];
      ACHIEVEMENTS.forEach(function (achievement) {
        if (!unlocked[achievement.id] && achievement.check(stats)) {
          unlocked[achievement.id] = true;
          newlyUnlocked.push(achievement);
        }
      });
      if (newlyUnlocked.length > 0) {
        return setUnlockedAchievements(unlocked).then(function () {
          return newlyUnlocked;
        });
      }
      return newlyUnlocked;
    });
  }

  function getTabActivity() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(STORAGE_KEYS.TAB_ACTIVITY, function (result) {
        resolve(result[STORAGE_KEYS.TAB_ACTIVITY] || {});
      });
    });
  }

  function setTabActivity(activity) {
    return new Promise(function (resolve) {
      var toStore = {};
      toStore[STORAGE_KEYS.TAB_ACTIVITY] = activity;
      chrome.storage.local.set(toStore, function () {
        resolve(activity);
      });
    });
  }

  function getActiveBattles() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(STORAGE_KEYS.ACTIVE_BATTLES, function (result) {
        resolve(result[STORAGE_KEYS.ACTIVE_BATTLES] || {});
      });
    });
  }

  function setActiveBattles(battles) {
    return new Promise(function (resolve) {
      var toStore = {};
      toStore[STORAGE_KEYS.ACTIVE_BATTLES] = battles;
      chrome.storage.local.set(toStore, function () {
        resolve(battles);
      });
    });
  }

  // ---------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------

  global.TBR = {
    NOTIFICATION_ICON_BASE64: NOTIFICATION_ICON_BASE64,
    STORAGE_KEYS: STORAGE_KEYS,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    DEFAULT_STATS: DEFAULT_STATS,
    ROASTS: ROASTS,
    ACHIEVEMENTS: ACHIEVEMENTS,
    safeParseInt: safeParseInt,
    parseDomainList: parseDomainList,
    getHostname: getHostname,
    hostnameMatchesList: hostnameMatchesList,
    pickRandomRoast: pickRandomRoast,
    getConfig: getConfig,
    setConfig: setConfig,
    getStats: getStats,
    setStats: setStats,
    getUnlockedAchievements: getUnlockedAchievements,
    setUnlockedAchievements: setUnlockedAchievements,
    evaluateAchievements: evaluateAchievements,
    getTabActivity: getTabActivity,
    setTabActivity: setTabActivity,
    getActiveBattles: getActiveBattles,
    setActiveBattles: setActiveBattles
  };
})(typeof self !== "undefined" ? self : window);
