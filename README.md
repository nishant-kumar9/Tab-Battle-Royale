# ⚔️ Tab Battle Royale

Welcome to Tab Battle Royale! This Chrome Extension gamifies your tab hoarding habits by forcing inactive tabs into a life-or-death battle for survival. 

If you leave tabs sitting open and unused, the extension will find them, inject a dramatic cyberpunk overlay onto the page, and force you to actively "Save" the tab within a time limit. If you fail, the tab is ruthlessly closed.

## 🚀 Installation (Load Unpacked)

Since this extension uses zero frameworks, zero backend, and no build tools, installation takes 30 seconds:

1. Create a new folder on your computer named `TabBattleRoyale`.
2. Save **all** the provided files (`manifest.json`, `background.js`, `options.html`, etc.) directly inside this folder. Ensure file names match exactly.
3. Open Google Chrome and navigate to `chrome://extensions/`.
4. Turn on **"Developer mode"** (toggle switch in the top right corner).
5. Click **"Load unpacked"** in the top left.
6. Select your `TabBattleRoyale` folder.
7. Done! Pin the extension to your toolbar to view stats.

## 🔑 Permissions Justification

- `tabs` & `sessions`: Required to query active/inactive tabs, close them, and fetch recently closed tabs for the Graveyard.
- `storage`: Required to save your settings, lifetime statistics, and achievements locally.
- `alarms`: Required to run the background job every minute to evaluate tab inactivity efficiently without killing your battery.
- `notifications`: Required to tell you when a tab dies, random events trigger, or achievements unlock.
- `scripting` & `<all_urls>`: Required to dynamically inject the dramatic battle overlay (HTML/CSS/JS) into the specific tab that is under attack.

## ⚙️ Features & Customization

- **Complete Customization:** Right-click the extension icon and select "Options". You can adjust the inactivity threshold (default 30 mins) and the countdown duration (default 10s).
- **Boss Battles:** If you open over 100 tabs, prepare for the FINAL BOSS event. The extension will challenge you to frantically click to save your 20 oldest tabs from being mass-executed.
- **Random Events:** Look out for "Meteor Strikes" (multi-tab battles) and "Sudden Death" events.
- **Graveyard:** Accidentally let a tab die? Click the extension icon to view the popup and check the "Graveyard" to revive it using Chrome's native sessions API.
- **Sound:** Web Audio API synth sounds (retro beeps and boops). Disabled by default. Enable in Settings.
- **Whitelists/Blacklists:** Protect your email and docs, or specifically target procrastination sites.

## ⌨️ Shortcuts

- `Ctrl + Shift + Y` (Windows/Linux) or `Cmd + Shift + Y` (Mac): Instantly triggers a battle on your current active tab. 

## 🛠 Troubleshooting

- **Overlay doesn't appear on some pages:** Chrome prevents extensions from running scripts on `chrome://` URLs, the Chrome Web Store, and local `file://` URLs. The extension intentionally ignores these tabs to prevent errors.
- **My tab closed automatically:** That's a feature, not a bug! You didn't save it in time!