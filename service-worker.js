const CHECK_INTERVAL = 1;
const INACTIVE_MINUTES = 30;

chrome.runtime.onInstalled.addListener(() => {

    chrome.alarms.create("battle", {
        periodInMinutes: CHECK_INTERVAL
    });

});

chrome.alarms.onAlarm.addListener(async (alarm) => {

    if (alarm.name !== "battle") return;

    const tabs = await chrome.tabs.query({});

    const now = Date.now();

    for (const tab of tabs) {

        if (!tab.id) continue;

        if (tab.active) continue;

        if (tab.pinned) continue;

        if (!tab.lastAccessed) continue;

        const inactive =
            (now - tab.lastAccessed) / 60000;

        if (inactive >= INACTIVE_MINUTES) {

            try {

                await chrome.scripting.executeScript({
                    target: {
                        tabId: tab.id
                    },
                    files: ["content.js"]
                });

            } catch (e) {}

        }

    }

});

chrome.runtime.onMessage.addListener((msg, sender) => {

    if (msg.type === "kill") {

        chrome.tabs.remove(sender.tab.id);

    }

});