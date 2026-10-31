"use strict";

const DEFAULTS = {
  enabled: false,
  prompt: "",
  model: "gpt-6-luna",
  failOpen: false,
};

const form = document.getElementById("settings");
const statusElement = document.getElementById("status");
const keyStatusElement = document.getElementById("keyStatus");
let hasSavedKey = false;

function setStatus(message, kind = "") {
  statusElement.textContent = message;
  statusElement.className = kind;
}

function formSettings() {
  return {
    enabled: document.getElementById("enabled").checked,
    prompt: document.getElementById("prompt").value.trim(),
    model: document.getElementById("model").value.trim(),
    failOpen: document.getElementById("failureMode").value === "open",
  };
}

async function save() {
  const settings = formSettings();
  if (!settings.prompt) throw new Error("Add a feed prompt.");
  if (!settings.model) throw new Error("Add a model name.");
  await chrome.storage.sync.set(settings);
  const apiKey = document.getElementById("apiKey").value.trim();
  if (apiKey) {
    await chrome.storage.local.set({ apiKey });
    document.getElementById("apiKey").value = "";
    hasSavedKey = true;
  }
  keyStatusElement.textContent = hasSavedKey ? "An API key is saved locally." : "No API key saved yet.";
  await chrome.runtime.sendMessage({ type: "settings-updated" });
  return { settings, apiKey: apiKey || null };
}

async function load() {
  const [settings, local] = await Promise.all([
    chrome.storage.sync.get(DEFAULTS),
    chrome.storage.local.get({ apiKey: "" }),
  ]);
  document.getElementById("enabled").checked = settings.enabled;
  document.getElementById("prompt").value = settings.prompt;
  document.getElementById("model").value = settings.model;
  document.getElementById("failureMode").value = settings.failOpen ? "open" : "closed";
  hasSavedKey = Boolean(local.apiKey);
  keyStatusElement.textContent = hasSavedKey ? "An API key is saved locally." : "No API key saved yet.";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Saving…");
  try {
    await save();
    setStatus("Saved", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

document.getElementById("test").addEventListener("click", async () => {
  setStatus("Testing…");
  try {
    const { settings, apiKey } = await save();
    const response = await chrome.runtime.sendMessage({ type: "test-api", settings, apiKey });
    if (!response?.ok) throw new Error(response?.error || "Test failed.");
    setStatus("API connection works", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

document.getElementById("clearKey").addEventListener("click", async () => {
  await chrome.storage.local.remove("apiKey");
  document.getElementById("apiKey").value = "";
  hasSavedKey = false;
  keyStatusElement.textContent = "No API key saved yet.";
  await chrome.runtime.sendMessage({ type: "settings-updated" });
  setStatus("Saved key cleared", "success");
});

load();
