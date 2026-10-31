"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const history = require("./history.js");

test("records classifications in hourly buckets and lifetime totals", () => {
  let result = history.record(null, [
    { include: true },
    { include: false },
    { include: true },
  ], "2026-09-01T10:15:00Z");
  result = history.record(result, [{ include: false }], "2026-09-01T10:55:00Z");

  assert.equal(result.allowed, 2);
  assert.equal(result.total, 4);
  assert.deepEqual(result.buckets, [{ hour: "2026-09-01T10:00:00.000Z", allowed: 2, total: 4 }]);
});

test("produces recent hourly hit rates", () => {
  const result = history.recentBuckets({
    version: 1,
    allowed: 4,
    total: 10,
    buckets: [
      { hour: "2026-09-01T10:00:00.000Z", allowed: 1, total: 5 },
      { hour: "2026-09-01T11:00:00.000Z", allowed: 3, total: 5 },
    ],
  });
  assert.deepEqual(result.map((bucket) => bucket.rate), [0.2, 0.6]);
});

test("retains only the last ninety days of hourly detail", () => {
  const result = history.record({
    version: 1,
    allowed: 1,
    total: 1,
    buckets: [{ hour: "2026-01-01T00:00:00.000Z", allowed: 1, total: 1 }],
  }, [{ include: true }], "2026-09-01T12:00:00Z");
  assert.deepEqual(result.buckets.map((bucket) => bucket.hour), ["2026-09-01T12:00:00.000Z"]);
  assert.equal(result.total, 2);
});
