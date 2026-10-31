(() => {
  "use strict";

  const STORAGE_KEY = "filterHistory";
  const RETENTION_DAYS = 90;

  function hourKey(dateLike = new Date()) {
    const date = new Date(dateLike);
    date.setMinutes(0, 0, 0);
    return date.toISOString();
  }

  function emptyHistory() {
    return { version: 1, allowed: 0, total: 0, buckets: [] };
  }

  function normalize(history) {
    if (!history || history.version !== 1) return emptyHistory();
    return {
      version: 1,
      allowed: Math.max(0, Number(history.allowed) || 0),
      total: Math.max(0, Number(history.total) || 0),
      buckets: Array.isArray(history.buckets)
        ? history.buckets
          .filter((bucket) => bucket?.hour && Number(bucket.total) > 0)
          .map((bucket) => ({
            hour: String(bucket.hour),
            allowed: Math.max(0, Number(bucket.allowed) || 0),
            total: Math.max(0, Number(bucket.total) || 0),
          }))
          .sort((left, right) => left.hour.localeCompare(right.hour))
        : [],
    };
  }

  function record(historyInput, decisions, dateLike = new Date()) {
    const history = normalize(historyInput);
    const valid = (decisions ?? []).filter((decision) => typeof decision?.include === "boolean");
    if (valid.length === 0) return history;
    const allowed = valid.filter((decision) => decision.include).length;
    const key = hourKey(dateLike);
    const bucket = history.buckets.find((candidate) => candidate.hour === key);
    if (bucket) {
      bucket.allowed += allowed;
      bucket.total += valid.length;
    } else {
      history.buckets.push({ hour: key, allowed, total: valid.length });
      history.buckets.sort((left, right) => left.hour.localeCompare(right.hour));
    }
    history.allowed += allowed;
    history.total += valid.length;

    const cutoff = new Date(dateLike);
    cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS);
    const cutoffKey = hourKey(cutoff);
    history.buckets = history.buckets.filter((candidate) => candidate.hour >= cutoffKey);
    return history;
  }

  function rate(allowed, total) {
    return total > 0 ? allowed / total : null;
  }

  function recentBuckets(historyInput, limit = 24) {
    return normalize(historyInput).buckets.slice(-Math.max(1, limit)).map((bucket) => ({
      ...bucket,
      rate: rate(bucket.allowed, bucket.total),
    }));
  }

  const api = { STORAGE_KEY, RETENTION_DAYS, emptyHistory, normalize, record, rate, recentBuckets, hourKey };
  globalThis.PromptedFeedHistory = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
