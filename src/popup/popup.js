"use strict";

const statePill = document.getElementById("statePill");
const summary = document.getElementById("summary");
const errorElement = document.getElementById("error");
const toggleButton = document.getElementById("toggle");
const retryButton = document.getElementById("retry");
let settings = null;
let activeTab = null;

async function render() {
  errorElement.textContent = "";
  const [settingsResponse, tabs] = await Promise.all([
    chrome.runtime.sendMessage({ type: "get-settings" }),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);
  settings = settingsResponse.settings;
  activeTab = tabs[0];
  const onTwitter = /^https:\/\/(x|twitter)\.com\//.test(activeTab?.url ?? "");
  const configured = Boolean(settings.prompt && settings.hasApiKey);
  const status = onTwitter
    ? await chrome.tabs.sendMessage(activeTab.id, { type: "get-feed-status" }).catch(() => null)
    : null;

  toggleButton.textContent = settings.enabled ? "Pause filter" : "Enable filter";
  retryButton.hidden = !status?.stats?.errors;
  errorElement.textContent = status?.stats?.lastError ?? "";
  document.getElementById("stats").hidden = !status?.active;
  if (status?.active) {
    document.getElementById("kept").textContent = status.stats.included;
    document.getElementById("hidden").textContent = status.stats.hidden;
    document.getElementById("pending").textContent = status.stats.pending;
  }

  if (!configured) {
    statePill.textContent = "Setup needed";
    statePill.className = "pill warning";
    summary.textContent = "Add a prompt and API key in Settings.";
  } else if (!settings.enabled) {
    statePill.textContent = "Paused";
    statePill.className = "pill";
    summary.textContent = settings.prompt;
  } else if (!onTwitter) {
    statePill.textContent = "Ready";
    statePill.className = "pill active";
    summary.textContent = "Open the X/Twitter Home feed to start filtering.";
  } else if (!status?.active) {
    statePill.textContent = "Home only";
    statePill.className = "pill";
    summary.textContent = "Filtering is enabled only on the Home timeline.";
  } else {
    statePill.textContent = "Filtering";
    statePill.className = "pill active";
    summary.textContent = settings.prompt;
  }
}

toggleButton.addEventListener("click", async () => {
  await chrome.storage.sync.set({ enabled: !settings.enabled });
  await chrome.runtime.sendMessage({ type: "settings-updated" });
  await render();
});

retryButton.addEventListener("click", async () => {
  if (activeTab?.id) await chrome.tabs.sendMessage(activeTab.id, { type: "retry-feed-errors" }).catch(() => {});
  window.close();
});

document.getElementById("options").addEventListener("click", () => chrome.runtime.openOptionsPage());
render().catch((error) => { errorElement.textContent = error.message; });
