"use strict";

importScripts("/lib/classifier.js", "/lib/history.js");

const classifier = globalThis.PromptedFeedClassifier;
const historyTools = globalThis.PromptedFeedHistory;
const DEFAULT_SETTINGS = {
  enabled: false,
  prompt: "",
  model: "gpt-6-luna",
  failOpen: false,
};

async function getSettings() {
  const [synced, local] = await Promise.all([
    chrome.storage.sync.get(DEFAULT_SETTINGS),
    chrome.storage.local.get({ apiKey: "" }),
  ]);
  return { ...DEFAULT_SETTINGS, ...synced, hasApiKey: Boolean(local.apiKey) };
}

async function classifyTweets(tweets, settingsOverride = null, apiKeyOverride = null) {
  const settings = settingsOverride ?? await getSettings();
  const stored = apiKeyOverride === null
    ? await chrome.storage.local.get({ apiKey: "" })
    : { apiKey: apiKeyOverride };
  if (!stored.apiKey) throw new Error("Add an OpenAI API key in Settings.");

  const response = await fetch(classifier.API_URL, {
    method: "POST",
    credentials: "omit",
    headers: {
      Authorization: `Bearer ${stored.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(classifier.buildRequest(settings, tweets)),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(classifier.apiErrorMessage(response.status, payload));
  const decisions = classifier.parseResponse(payload, tweets.map((tweet) => tweet.id));
  return {
    decisions: tweets.map((tweet) => ({ id: tweet.id, include: decisions.get(String(tweet.id)) })),
    usage: payload.usage ?? null,
  };
}

let historyQueue = Promise.resolve();

function recordFilterHistory(decisions) {
  const task = historyQueue.then(async () => {
    const stored = await chrome.storage.local.get({ [historyTools.STORAGE_KEY]: historyTools.emptyHistory() });
    const history = historyTools.record(stored[historyTools.STORAGE_KEY], decisions);
    await chrome.storage.local.set({ [historyTools.STORAGE_KEY]: history });
    return history;
  });
  historyQueue = task.catch(() => {});
  return task;
}

async function getFilterHistory() {
  await historyQueue;
  const stored = await chrome.storage.local.get({ [historyTools.STORAGE_KEY]: historyTools.emptyHistory() });
  return historyTools.normalize(stored[historyTools.STORAGE_KEY]);
}

async function broadcastSettings() {
  const tabs = await chrome.tabs.query({ url: ["https://x.com/*", "https://twitter.com/*"] });
  await Promise.all(tabs.map((tab) => chrome.tabs.sendMessage(tab.id, { type: "settings-changed" }).catch(() => {})));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "get-settings") {
    getSettings().then((settings) => sendResponse({ ok: true, settings }));
    return true;
  }
  if (message?.type === "classify-tweets") {
    classifyTweets(message.tweets)
      .then(async (result) => {
        const history = await recordFilterHistory(result.decisions);
        sendResponse({ ok: true, ...result, history });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "get-filter-history") {
    getFilterHistory()
      .then((history) => sendResponse({ ok: true, history }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "test-api") {
    classifyTweets(
      [{ id: "test", author: "Prompted Feed", text: "A test post used to verify the filter configuration.", media: [] }],
      message.settings,
      message.apiKey ?? null,
    )
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "settings-updated") {
    broadcastSettings().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "feed-stats" && sender.tab?.id) {
    const hidden = Number(message.stats?.hidden ?? 0);
    chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: "#7c3aed" });
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: hidden ? String(hidden) : "" });
    return false;
  }
  if (message?.type === "open-tweet-tab") {
    let url;
    try {
      url = new URL(message.url);
    } catch (_error) {
      sendResponse({ ok: false, error: "Invalid tweet URL." });
      return false;
    }
    if (!['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname)) {
      sendResponse({ ok: false, error: "Only X/Twitter links can be opened." });
      return false;
    }
    chrome.tabs.create({ url: url.href, active: message.active === true })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  return false;
});

const RETIRED_DEFAULT_MODELS = ["gpt-5.6-luna"];

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") chrome.runtime.openOptionsPage();
  if (details.reason === "update") {
    const { model } = await chrome.storage.sync.get("model");
    if (RETIRED_DEFAULT_MODELS.includes(model)) await chrome.storage.sync.set({ model: DEFAULT_SETTINGS.model });
  }
});
