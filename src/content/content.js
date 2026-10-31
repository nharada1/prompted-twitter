(() => {
  "use strict";

  const tweetTools = globalThis.PromptedFeedTweet;
  const historyTools = globalThis.PromptedFeedHistory;
  const BATCH_SIZE = 12;
  const BATCH_DELAY_MS = 120;
  const HARVEST_CHUNK = 60;
  const ALLOWED_BUFFER = 12;
  const decisionCache = new Map();
  const queuedRecords = new Map();
  const tweetRecords = new Map();
  const loadedPosts = new Set();
  const allowedPosts = new Set();
  const filteredPosts = new Set();
  const pendingPosts = new Set();
  const errorPosts = new Set();
  const renderedCards = new Map();
  const sourceSnapshots = new Map();
  let settings = null;
  let batchTimer = null;
  let processing = false;
  let scanScheduled = false;
  let settingsGeneration = 0;
  let lastPathname = location.pathname;
  let lastStatsFingerprint = "";
  let lastError = null;
  let harvestLimit = HARVEST_CHUNK;
  let desiredAllowed = ALLOWED_BUFFER;
  let harvestTimer = null;
  let harvestInFlight = false;
  let harvestStartCount = 0;
  let harvestAttempts = 0;
  let autoloadStalled = false;
  let filterHistory = historyTools.emptyHistory();
  let stats = { loaded: 0, included: 0, hidden: 0, pending: 0, errors: 0, lastError: null };

  function configured() {
    return Boolean(settings?.enabled && settings?.prompt?.trim() && settings?.hasApiKey);
  }

  function activeOnThisPage() {
    return configured() && tweetTools.isHomeFeed(location);
  }

  function ensureDebugPanel() {
    let panel = document.getElementById("prompted-feed-debug");
    if (panel) return panel;
    panel = document.createElement("aside");
    panel.id = "prompted-feed-debug";
    panel.innerHTML = [
      "<strong>Prompted Feed</strong>",
      '<span data-prompted-feed-debug="counts">0 loaded · 0 allowed</span>',
      '<span data-prompted-feed-debug="detail">Waiting for posts…</span>',
      '<div class="prompted-feed-hit-rate">',
      '<span data-prompted-feed-debug="rate">No hit-rate history yet</span>',
      '<svg data-prompted-feed-debug="chart" viewBox="0 0 180 42" role="img" aria-label="Hourly filter hit rate">',
      '<line x1="0" y1="21" x2="180" y2="21"></line>',
      '<path data-prompted-feed-debug="line" d=""></path>',
      '<circle data-prompted-feed-debug="point" cx="0" cy="0" r="2.5" hidden></circle>',
      "</svg>",
      "</div>",
    ].join("");
    (document.body || document.documentElement)?.append(panel);
    return panel;
  }

  function extendHarvest() {
    harvestLimit += HARVEST_CHUNK;
    desiredAllowed += ALLOWED_BUFFER;
    autoloadStalled = false;
    harvestInFlight = false;
    clearTimeout(harvestTimer);
    maybeHarvest(true);
  }

  function ensureCustomFeed() {
    let feed = document.getElementById("prompted-feed-custom");
    if (feed) return feed;
    feed = document.createElement("section");
    feed.id = "prompted-feed-custom";
    feed.innerHTML = [
      '<header class="prompted-feed-custom-header">',
      "<div><strong>Prompted Feed</strong><span>Filtered by your prompt</span></div>",
      '<span data-prompted-feed-custom="summary">Starting…</span>',
      "</header>",
      '<main data-prompted-feed-custom="list"></main>',
      '<footer class="prompted-feed-custom-footer">',
      '<span data-prompted-feed-custom="status">Scanning X for matches…</span>',
      '<button data-prompted-feed-custom="more" type="button">Scan more posts</button>',
      "</footer>",
    ].join("");
    feed.querySelector("[data-prompted-feed-custom='more']").addEventListener("click", extendHarvest);
    feed.addEventListener("scroll", () => {
      const nearBottom = feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 500;
      if (nearBottom && allowedPosts.size >= desiredAllowed && !processing && queuedRecords.size === 0) {
        extendHarvest();
      }
    }, { passive: true });
    (document.body || document.documentElement)?.append(feed);
    return feed;
  }

  function positionCustomFeed() {
    const feed = ensureCustomFeed();
    const primaryColumn = document.querySelector("[data-testid='primaryColumn']");
    if (!feed || !primaryColumn) return;
    const rect = primaryColumn.getBoundingClientRect();
    feed.style.left = `${Math.max(0, rect.left)}px`;
    const availableWidth = Math.max(320, window.innerWidth - Math.max(0, rect.left) - 24);
    feed.style.width = `${Math.max(320, Math.min(900, availableWidth))}px`;
    const pageStyle = getComputedStyle(document.body);
    feed.style.setProperty("--prompted-feed-native-bg", pageStyle.backgroundColor);
    feed.style.setProperty("--prompted-feed-native-color", pageStyle.color);
  }

  function setPageMode() {
    const active = activeOnThisPage();
    document.documentElement?.classList.toggle("prompted-feed-active", active);
    document.documentElement?.classList.toggle("prompted-feed-custom-active", active);
    if (active) {
      ensureDebugPanel();
      ensureCustomFeed();
      positionCustomFeed();
    } else {
      queuedRecords.clear();
      pendingPosts.clear();
    }
  }

  function displayTimestamp(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function createCustomCard(tweet, { unclassified = false } = {}) {
    const card = document.createElement("article");
    card.className = "prompted-feed-card";
    card.dataset.promptedFeedCard = tweet.signature;
    if (unclassified) card.dataset.promptedFeedUnclassified = "true";

    if (tweet.socialContext) {
      const context = document.createElement("div");
      context.className = "prompted-feed-card-context";
      context.textContent = tweet.socialContext;
      card.append(context);
    }

    const heading = document.createElement("div");
    heading.className = "prompted-feed-card-heading";
    if (tweet.avatarUrl) {
      const avatar = document.createElement("img");
      avatar.className = "prompted-feed-card-avatar";
      avatar.src = tweet.avatarUrl;
      avatar.alt = "";
      heading.append(avatar);
    }
    const identity = document.createElement("div");
    identity.className = "prompted-feed-card-identity";
    const author = document.createElement("strong");
    author.textContent = tweet.author || "Post on X";
    identity.append(author);
    const timestamp = displayTimestamp(tweet.timestamp);
    if (timestamp) {
      const time = document.createElement("span");
      time.textContent = timestamp;
      identity.append(time);
    }
    heading.append(identity);
    card.append(heading);

    const text = document.createElement("p");
    text.className = "prompted-feed-card-text";
    text.textContent = tweet.text;
    card.append(text);

    if (tweet.imageUrls?.length) {
      const gallery = document.createElement("div");
      gallery.className = "prompted-feed-card-gallery";
      gallery.dataset.count = String(tweet.imageUrls.length);
      for (const [index, source] of tweet.imageUrls.entries()) {
        const image = document.createElement("img");
        image.src = source;
        image.alt = tweet.media?.[index] || "Post image";
        image.loading = "lazy";
        gallery.append(image);
      }
      card.append(gallery);
    } else if (tweet.media?.length) {
      const mediaLabel = document.createElement("div");
      mediaLabel.className = "prompted-feed-card-media-label";
      mediaLabel.textContent = tweet.media.join(" · ");
      card.append(mediaLabel);
    }

    const link = document.createElement("a");
    link.className = "prompted-feed-card-link";
    link.href = tweet.url;
    link.textContent = unclassified ? "View unclassified post on X →" : "View on X →";
    card.append(link);
    makeCardNavigable(card, tweet);
    return card;
  }

  function snapshotNativeArticle(article) {
    const clone = article.cloneNode(true);
    clone.removeAttribute("id");
    clone.removeAttribute("data-prompted-feed-key");
    clone.removeAttribute("data-prompted-feed-state");
    clone.removeAttribute("data-prompted-feed-expanded");
    clone.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
    clone.querySelectorAll("[data-prompted-feed-key], [data-prompted-feed-state]").forEach((element) => {
      element.removeAttribute("data-prompted-feed-key");
      element.removeAttribute("data-prompted-feed-state");
    });
    clone.querySelectorAll("[data-prompted-feed-expanded]").forEach((element) => {
      element.removeAttribute("data-prompted-feed-expanded");
    });
    const originalImages = [...article.querySelectorAll("img")];
    const clonedImages = [...clone.querySelectorAll("img")];
    originalImages.forEach((image, index) => {
      const clonedImage = clonedImages[index];
      const source = image.currentSrc || image.src || image.getAttribute("src");
      if (!clonedImage || !source) return;
      clonedImage.src = source;
      clonedImage.removeAttribute("srcset");
      clonedImage.removeAttribute("sizes");
      clonedImage.loading = "eager";
      clonedImage.decoding = "async";
    });
    const originalVideos = [...article.querySelectorAll("video")];
    const clonedVideos = [...clone.querySelectorAll("video")];
    originalVideos.forEach((video, index) => {
      const clonedVideo = clonedVideos[index];
      if (!clonedVideo) return;
      const source = video.currentSrc || video.src || video.getAttribute("src");
      const poster = video.poster || video.getAttribute("poster");
      if (source) clonedVideo.src = source;
      if (poster) clonedVideo.poster = poster;
      clonedVideo.controls = true;
      clonedVideo.autoplay = false;
      clonedVideo.muted = video.muted;
      clonedVideo.removeAttribute("autoplay");
    });
    return clone;
  }

  function expandNativeTweet(article) {
    const controls = article.querySelectorAll("[data-testid='tweet-text-show-more-link']");
    let clicked = false;
    controls.forEach((control) => {
      if (control.dataset.promptedFeedExpanded === "true") return;
      control.dataset.promptedFeedExpanded = "true";
      control.click();
      clicked = true;
    });
    return clicked;
  }

  function openXTab(url, active = false) {
    chrome.runtime.sendMessage({ type: "open-tweet-tab", url, active }).catch(() => {});
  }

  function tweetNumericId(tweet) {
    return tweet.id.startsWith("status:") ? tweet.id.slice("status:".length) : "";
  }

  function findLiveArticle(tweet) {
    const statusId = tweetNumericId(tweet);
    if (!statusId) return null;
    return [...document.querySelectorAll("[data-testid='primaryColumn'] article[data-testid='tweet']")]
      .find((article) => [...article.querySelectorAll("a[href*='/status/']")]
        .some((link) => tweetTools.statusIdFromHref(link.getAttribute("href")) === statusId)) ?? null;
  }

  function refreshRenderedTweet(tweet) {
    const article = findLiveArticle(tweet);
    if (!article) return;
    sourceSnapshots.set(tweet.signature, snapshotNativeArticle(article));
    removeRenderedTweet(tweet.signature);
    renderAllowedTweet(tweet);
    sourceSnapshots.delete(tweet.signature);
  }

  async function shareTweet(tweet) {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Post on X", url: tweet.url });
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }
    await navigator.clipboard?.writeText(tweet.url);
  }

  function intentUrl(tweet, action) {
    const id = tweetNumericId(tweet);
    if (!id) return tweet.url;
    if (action === "reply") return `https://twitter.com/intent/tweet?in_reply_to=${encodeURIComponent(id)}`;
    if (action === "retweet") return `https://twitter.com/intent/retweet?tweet_id=${encodeURIComponent(id)}`;
    if (action === "like") return `https://twitter.com/intent/like?tweet_id=${encodeURIComponent(id)}`;
    return tweet.url;
  }

  function actionFromTarget(target) {
    const control = target.closest("[data-testid]");
    const testId = control?.getAttribute("data-testid") ?? "";
    if (["like", "unlike"].includes(testId)) return { name: "like", testId };
    if (["retweet", "unretweet"].includes(testId)) return { name: "retweet", testId };
    if (["bookmark", "removeBookmark"].includes(testId)) return { name: "bookmark", testId };
    if (testId === "reply") return { name: "reply", testId };
    if (testId === "share") return { name: "share", testId };
    return null;
  }

  function handleTweetAction(tweet, action) {
    if (action.name === "share") {
      shareTweet(tweet).catch(() => openXTab(tweet.url, true));
      return;
    }

    const liveArticle = findLiveArticle(tweet);
    const liveControl = liveArticle?.querySelector(`[data-testid='${action.testId}']`);
    if (liveControl && ["like", "bookmark"].includes(action.name)) {
      liveControl.click();
      setTimeout(() => refreshRenderedTweet(tweet), 450);
      return;
    }

    const isRemoval = ["unlike", "unretweet", "removeBookmark"].includes(action.testId);
    openXTab(isRemoval ? tweet.url : intentUrl(tweet, action.name), true);
  }

  function makeCardNavigable(shell, tweet) {
    shell.addEventListener("click", (event) => {
      const action = actionFromTarget(event.target);
      if (action) {
        event.preventDefault();
        event.stopPropagation();
        handleTweetAction(tweet, action);
        return;
      }
      if (event.target.closest("video, [data-testid='videoPlayer']")) return;
      if (event.defaultPrevented || event.target.closest("a[href]")) return;
      if (event.target.closest("button, [role='button']")) {
        event.preventDefault();
        openXTab(tweet.url, true);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.shiftKey) {
        event.preventDefault();
        openXTab(tweet.url, !event.metaKey && !event.ctrlKey);
        return;
      }
      window.location.assign(tweet.url);
    });
    shell.addEventListener("auxclick", (event) => {
      if (event.button !== 1) return;
      // Real anchors already have correct browser-native middle-click behavior.
      if (event.target.closest("a[href]")) return;
      event.preventDefault();
      event.stopPropagation();
      openXTab(tweet.url, false);
    });
  }

  function createNativeCard(tweet, options = {}) {
    const snapshot = sourceSnapshots.get(tweet.signature);
    if (!snapshot) return createCustomCard(tweet, options);

    const shell = document.createElement("div");
    shell.className = "prompted-feed-native-card";
    shell.dataset.promptedFeedCard = tweet.signature;
    if (options.unclassified) shell.dataset.promptedFeedUnclassified = "true";
    const clone = snapshot.cloneNode(true);
    const clonedMedia = [...clone.querySelectorAll(
      "[data-testid='tweetPhoto'] img, [data-testid='card.layoutLarge.media'] img, [data-testid='card.layoutSmall.media'] img",
    )];
    clonedMedia.forEach((image, index) => {
      const source = tweet.imageUrls?.[index];
      if (!source) return;
      image.src = source;
      image.removeAttribute("srcset");
      image.removeAttribute("sizes");
      image.loading = "eager";
    });

    clone.querySelectorAll("video").forEach((video) => {
      video.controls = true;
      video.addEventListener("click", (event) => event.stopPropagation());
    });
    makeCardNavigable(shell, tweet);
    shell.append(clone);
    return shell;
  }

  function renderAllowedTweet(tweet, options = {}) {
    const existing = renderedCards.get(tweet.signature);
    if (existing && existing.isConnected) return;
    const list = ensureCustomFeed()?.querySelector("[data-prompted-feed-custom='list']");
    if (!list) return;
    const card = createNativeCard(tweet, options);
    renderedCards.set(tweet.signature, card);
    list.append(card);
  }

  function removeRenderedTweet(signature) {
    renderedCards.get(signature)?.remove();
    renderedCards.delete(signature);
  }

  function rememberDecision(signature, include) {
    decisionCache.set(signature, include);
    if (decisionCache.size > 1000) decisionCache.delete(decisionCache.keys().next().value);
  }

  function applyDecision(article, tweet, include) {
    if (article?.isConnected && article.dataset.promptedFeedKey === tweet.signature) {
      article.dataset.promptedFeedState = include ? "include" : "exclude";
    }
    pendingPosts.delete(tweet.signature);
    errorPosts.delete(tweet.signature);
    if (include) {
      allowedPosts.add(tweet.signature);
      filteredPosts.delete(tweet.signature);
      if (article?.isConnected) {
        sourceSnapshots.set(tweet.signature, snapshotNativeArticle(article));
      }
      renderAllowedTweet(tweet);
    } else {
      filteredPosts.add(tweet.signature);
      allowedPosts.delete(tweet.signature);
      removeRenderedTweet(tweet.signature);
    }
    sourceSnapshots.delete(tweet.signature);
  }

  function renderStatus() {
    const debug = ensureDebugPanel();
    if (debug) {
      const countsElement = debug.querySelector("[data-prompted-feed-debug='counts']");
      const countsText = `${stats.loaded} loaded · ${stats.included} allowed`;
      if (countsElement.textContent !== countsText) countsElement.textContent = countsText;
      const details = [`${stats.hidden} filtered`];
      if (stats.pending) details.push(`${stats.pending} checking`);
      if (stats.errors) details.push(`${stats.errors} API errors`);
      const detailElement = debug.querySelector("[data-prompted-feed-debug='detail']");
      const detailText = details.join(" · ");
      if (detailElement.textContent !== detailText) detailElement.textContent = detailText;
      renderHitRate(debug);
    }

    const feed = ensureCustomFeed();
    if (!feed) return;
    const summaryElement = feed.querySelector("[data-prompted-feed-custom='summary']");
    const summaryText = `${stats.included} shown · ${stats.hidden} filtered`;
    if (summaryElement.textContent !== summaryText) summaryElement.textContent = summaryText;
    const statusElement = feed.querySelector("[data-prompted-feed-custom='status']");
    const moreButton = feed.querySelector("[data-prompted-feed-custom='more']");
    const pausedForLimit = loadedPosts.size >= harvestLimit && allowedPosts.size < desiredAllowed;
    const paused = pausedForLimit || autoloadStalled;
    moreButton.hidden = !paused;
    let statusText;
    if (lastError) {
      statusText = lastError;
    } else if (processing || queuedRecords.size || loadedPosts.size < harvestLimit && allowedPosts.size < desiredAllowed) {
      statusText = "Scanning X for more matches…";
    } else if (autoloadStalled) {
      statusText = "X did not expose more posts. Scan again to retry.";
    } else if (pausedForLimit) {
      statusText = `Paused after checking ${loadedPosts.size} posts.`;
    } else {
      statusText = "You're caught up with the filtered results.";
    }
    if (statusElement.textContent !== statusText) statusElement.textContent = statusText;
  }

  function renderHitRate(debug) {
    const buckets = historyTools.recentBuckets(filterHistory, 24);
    const label = debug.querySelector("[data-prompted-feed-debug='rate']");
    const chart = debug.querySelector("[data-prompted-feed-debug='chart']");
    const line = debug.querySelector("[data-prompted-feed-debug='line']");
    const point = debug.querySelector("[data-prompted-feed-debug='point']");
    const lifetimeRate = historyTools.rate(filterHistory.allowed, filterHistory.total);
    if (lifetimeRate === null || buckets.length === 0) {
      label.textContent = "No hit-rate history yet";
      line.setAttribute("d", "");
      point.hidden = true;
      chart.setAttribute("aria-label", "No filter hit-rate history yet");
      return;
    }

    const width = 180;
    const height = 42;
    const inset = 3;
    const xFor = (index) => buckets.length === 1
      ? width / 2
      : inset + index * ((width - inset * 2) / (buckets.length - 1));
    const yFor = (rate) => inset + (1 - rate) * (height - inset * 2);
    const path = buckets.map((bucket, index) => {
      const command = index === 0 ? "M" : "L";
      return `${command}${xFor(index).toFixed(1)},${yFor(bucket.rate).toFixed(1)}`;
    }).join(" ");
    line.setAttribute("d", path);
    const latest = buckets[buckets.length - 1];
    point.setAttribute("cx", xFor(buckets.length - 1).toFixed(1));
    point.setAttribute("cy", yFor(latest.rate).toFixed(1));
    point.hidden = false;
    const percent = Math.round(lifetimeRate * 100);
    label.textContent = `${percent}% lifetime hit rate · ${filterHistory.allowed}/${filterHistory.total}`;
    chart.setAttribute(
      "aria-label",
      `Hourly filter hit rate across ${buckets.length} recorded hours. Lifetime ${percent} percent.`,
    );
  }

  function recalculateStats() {
    stats = {
      loaded: loadedPosts.size,
      included: allowedPosts.size,
      hidden: filteredPosts.size,
      pending: pendingPosts.size,
      errors: errorPosts.size,
      lastError,
    };
    renderStatus();
    const fingerprint = JSON.stringify(stats);
    if (fingerprint !== lastStatsFingerprint) {
      lastStatsFingerprint = fingerprint;
      chrome.runtime.sendMessage({ type: "feed-stats", stats }).catch(() => {});
    }
  }

  function enqueue(article) {
    if (expandNativeTweet(article)) {
      scheduleScan();
      return;
    }
    const tweet = tweetTools.extractTweet(article);
    if (!tweet.text && tweet.media.length === 0) return;
    if (!sourceSnapshots.has(tweet.signature)) {
      sourceSnapshots.set(tweet.signature, snapshotNativeArticle(article));
    }
    if (article.dataset.promptedFeedKey === tweet.signature && article.dataset.promptedFeedState) return;

    article.dataset.promptedFeedKey = tweet.signature;
    tweetRecords.set(tweet.signature, tweet);
    loadedPosts.add(tweet.signature);
    const cached = decisionCache.get(tweet.signature);
    if (typeof cached === "boolean") {
      applyDecision(article, tweet, cached);
      return;
    }
    article.dataset.promptedFeedState = "pending";
    pendingPosts.add(tweet.signature);
    queuedRecords.set(tweet.signature, { article, tweet });
  }

  function scan() {
    if (location.pathname !== lastPathname) {
      lastPathname = location.pathname;
      setPageMode();
    }
    if (!activeOnThisPage()) return;
    positionCustomFeed();
    document.querySelectorAll("[data-testid='primaryColumn'] article[data-testid='tweet']").forEach(enqueue);
    if (harvestInFlight && loadedPosts.size > harvestStartCount) {
      clearTimeout(harvestTimer);
      harvestInFlight = false;
      harvestAttempts = 0;
      autoloadStalled = false;
    }
    recalculateStats();
    scheduleBatch();
    maybeHarvest();
  }

  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(() => {
      scanScheduled = false;
      scan();
    }, 50);
  }

  function scheduleBatch() {
    if (processing || batchTimer || queuedRecords.size === 0) return;
    batchTimer = setTimeout(() => {
      batchTimer = null;
      processNextBatch();
    }, BATCH_DELAY_MS);
  }

  function nativeScrollToBottom() {
    const scroller = document.scrollingElement || document.documentElement;
    const target = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    scroller.scrollTop = target;
    window.scrollTo({ top: target, behavior: "auto" });
    return { scroller, target };
  }

  function attemptHarvest() {
    if (!harvestInFlight || !activeOnThisPage()) return;
    harvestAttempts += 1;
    const { scroller, target } = nativeScrollToBottom();
    clearTimeout(harvestTimer);
    harvestTimer = setTimeout(() => {
      scan();
      if (loadedPosts.size > harvestStartCount) {
        harvestInFlight = false;
        harvestAttempts = 0;
        autoloadStalled = false;
        maybeHarvest();
        return;
      }
      if (harvestAttempts < 3) {
        // Re-cross X's bottom sentinel. This handles a loader that mounted after
        // the first scroll or a virtualizer that ignored an unchanged endpoint.
        const nudge = Math.max(0, target - Math.floor(window.innerHeight * 0.4));
        scroller.scrollTop = nudge;
        window.scrollTo({ top: nudge, behavior: "auto" });
        harvestTimer = setTimeout(attemptHarvest, 160);
        return;
      }
      harvestInFlight = false;
      autoloadStalled = true;
      recalculateStats();
    }, 1800);
  }

  function maybeHarvest(immediate = false) {
    if (!activeOnThisPage()) return;
    if (allowedPosts.size >= desiredAllowed || loadedPosts.size >= harvestLimit) return;
    if (processing || queuedRecords.size > 0) return;
    if (loadedPosts.size === 0 || harvestInFlight || autoloadStalled && !immediate) return;
    clearTimeout(harvestTimer);
    harvestTimer = setTimeout(() => {
      if (!activeOnThisPage()) return;
      harvestInFlight = true;
      harvestStartCount = loadedPosts.size;
      harvestAttempts = 0;
      attemptHarvest();
    }, immediate ? 0 : 350);
  }

  async function processNextBatch() {
    if (processing || !activeOnThisPage()) return;
    const records = [...queuedRecords.values()].slice(0, BATCH_SIZE);
    records.forEach(({ tweet }) => queuedRecords.delete(tweet.signature));
    if (records.length === 0) return;

    processing = true;
    const batchGeneration = settingsGeneration;
    try {
      const response = await chrome.runtime.sendMessage({
        type: "classify-tweets",
        tweets: records.map((record) => record.tweet),
      });
      if (!response?.ok) throw new Error(response?.error || "The classifier did not respond.");
      if (response.history) filterHistory = historyTools.normalize(response.history);
      const decisions = new Map(response.decisions.map((decision) => [String(decision.id), decision.include]));
      if (batchGeneration !== settingsGeneration) return;
      lastError = null;
      for (const { article, tweet } of records) {
        const include = decisions.get(String(tweet.id));
        if (typeof include !== "boolean") throw new Error("A post was missing from the classification result.");
        rememberDecision(tweet.signature, include);
        applyDecision(article, tweet, include);
      }
    } catch (error) {
      if (batchGeneration !== settingsGeneration) return;
      lastError = error.message;
      for (const { article, tweet } of records) {
        pendingPosts.delete(tweet.signature);
        errorPosts.add(tweet.signature);
        if (article?.isConnected && article.dataset.promptedFeedKey === tweet.signature) {
          article.dataset.promptedFeedState = settings.failOpen ? "error-shown" : "error-hidden";
        }
        if (settings.failOpen) renderAllowedTweet(tweet, { unclassified: true });
      }
    } finally {
      processing = false;
      recalculateStats();
      scheduleBatch();
      maybeHarvest();
    }
  }

  function resetSession() {
    decisionCache.clear();
    queuedRecords.clear();
    tweetRecords.clear();
    loadedPosts.clear();
    allowedPosts.clear();
    filteredPosts.clear();
    pendingPosts.clear();
    errorPosts.clear();
    renderedCards.clear();
    sourceSnapshots.clear();
    harvestLimit = HARVEST_CHUNK;
    desiredAllowed = ALLOWED_BUFFER;
    harvestInFlight = false;
    harvestStartCount = 0;
    harvestAttempts = 0;
    autoloadStalled = false;
    clearTimeout(harvestTimer);
    lastError = null;
    document.querySelector("[data-prompted-feed-custom='list']")?.replaceChildren();
    document.querySelectorAll("[data-testid='primaryColumn'] article[data-testid='tweet']").forEach((article) => {
      delete article.dataset.promptedFeedState;
      delete article.dataset.promptedFeedKey;
    });
  }

  async function loadSettings({ clear = false } = {}) {
    const response = await chrome.runtime.sendMessage({ type: "get-settings" }).catch(() => null);
    settings = response?.settings ?? { enabled: false };
    if (clear) {
      settingsGeneration += 1;
      resetSession();
    }
    setPageMode();
    scan();
  }

  async function loadFilterHistory() {
    const response = await chrome.runtime.sendMessage({ type: "get-filter-history" }).catch(() => null);
    if (response?.ok && response.history) {
      filterHistory = historyTools.normalize(response.history);
      recalculateStats();
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "settings-changed") {
      loadSettings({ clear: true }).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (message?.type === "get-feed-status") {
      sendResponse({ ok: true, active: activeOnThisPage(), configured: configured(), stats });
      return false;
    }
    if (message?.type === "retry-feed-errors") {
      lastError = null;
      for (const signature of errorPosts) {
        const tweet = tweetRecords.get(signature);
        if (!tweet) continue;
        removeRenderedTweet(signature);
        pendingPosts.add(signature);
        queuedRecords.set(signature, { article: null, tweet });
      }
      errorPosts.clear();
      recalculateStats();
      scheduleBatch();
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  new MutationObserver((mutations) => {
    const twitterChanged = mutations.some((mutation) => {
      const element = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
      return !element?.closest?.("#prompted-feed-custom, #prompted-feed-debug");
    });
    if (twitterChanged) scheduleScan();
  }).observe(document, { childList: true, subtree: true, characterData: true });
  window.addEventListener("resize", positionCustomFeed, { passive: true });
  ensureDebugPanel();
  ensureCustomFeed();
  loadSettings();
  loadFilterHistory();
})();
