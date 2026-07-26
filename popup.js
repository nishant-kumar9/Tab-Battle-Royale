async function update() {

    const tabs = await chrome.tabs.query({});

    document.getElementById("count").textContent =
        `Open Tabs: ${tabs.length}`;

}

document.getElementById("refresh")
.onclick = update;

update();