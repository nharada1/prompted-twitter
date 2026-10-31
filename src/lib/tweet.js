(() => {
  "use strict";

  function clean(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function stableHash(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function statusIdFromHref(href) {
    const match = String(href ?? "").match(/\/status\/(\d+)/);
    return match?.[1] ?? null;
  }

  function tweetFromParts({
    statusHref,
    author,
    text,
    media = [],
    imageUrls = [],
    avatarUrl = "",
    timestamp = "",
    socialContext = "",
  }) {
    const normalized = {
      author: clean(author).slice(0, 240),
      text: clean(text).slice(0, 3000),
      media: media.map(clean).filter(Boolean).slice(0, 6),
    };
    const statusId = statusIdFromHref(statusHref);
    const signature = JSON.stringify(normalized);
    const id = statusId ? `status:${statusId}` : `content:${stableHash(signature)}`;
    return {
      id,
      ...normalized,
      url: statusHref
        ? (String(statusHref).startsWith("http") ? String(statusHref) : `https://x.com${statusHref}`)
        : "https://x.com/home",
      imageUrls: imageUrls.map(String).filter(Boolean).slice(0, 4),
      avatarUrl: String(avatarUrl || ""),
      timestamp: String(timestamp || ""),
      socialContext: clean(socialContext).slice(0, 240),
      // X updates counters, cards, and media metadata inside mounted tweets. Once a
      // status id exists, keep the identity stable so those DOM updates do not
      // repeatedly send the same post back through the classifier.
      signature: stableHash(statusId ? id : signature),
    };
  }

  function extractTweet(article) {
    const statusLink = [...article.querySelectorAll("a[href*='/status/']")]
      .find((link) => statusIdFromHref(link.getAttribute("href")));
    const author = article.querySelector("[data-testid='User-Name']")?.innerText ?? "";
    const tweetTexts = [...article.querySelectorAll("[data-testid='tweetText']")]
      .map((element) => element.innerText)
      .filter(Boolean);
    const cardTexts = [...article.querySelectorAll("[data-testid='card.layoutLarge.media'], [data-testid='card.layoutSmall.media']")]
      .map((element) => element.innerText)
      .filter(Boolean);
    const mediaImages = [...article.querySelectorAll(
      "[data-testid='tweetPhoto'] img, [data-testid='card.layoutLarge.media'] img, [data-testid='card.layoutSmall.media'] img",
    )];
    const media = mediaImages
      .map((image) => image.getAttribute("alt"))
      .filter((alt) => alt && alt !== "Image");
    const imageUrls = mediaImages.map((image) => image.currentSrc || image.src).filter(Boolean);
    const avatarUrl = article.querySelector("[data-testid='Tweet-User-Avatar'] img")?.currentSrc
      || article.querySelector("[data-testid='Tweet-User-Avatar'] img")?.src
      || "";
    const time = article.querySelector("time");
    const socialContext = article.querySelector("[data-testid='socialContext']")?.innerText ?? "";
    const text = [...tweetTexts, ...cardTexts].join("\n");

    // Image-only and link-only posts can lack tweetText. The article's visible text is
    // still preferable to dropping the post without giving the classifier any context.
    const fallbackText = text || article.innerText || "";
    return tweetFromParts({
      statusHref: statusLink?.getAttribute("href") ?? "",
      author,
      text: fallbackText,
      media,
      imageUrls,
      avatarUrl,
      timestamp: time?.getAttribute("datetime") ?? time?.innerText ?? "",
      socialContext,
    });
  }

  function isHomeFeed(locationLike) {
    return /^\/home\/?$/.test(String(locationLike?.pathname ?? ""));
  }

  const api = { clean, stableHash, statusIdFromHref, tweetFromParts, extractTweet, isHomeFeed };
  globalThis.PromptedFeedTweet = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
