"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const tweet = require("../src/lib/tweet.js");

test("uses a stable X status id when available", () => {
  const result = tweet.tweetFromParts({
    statusHref: "/openai/status/1234567890",
    author: " OpenAI  @OpenAI ",
    text: " A new model\n\nis here ",
    media: [" diagram "],
  });
  assert.equal(result.id, "status:1234567890");
  assert.equal(result.text, "A new model is here");
  assert.deepEqual(result.media, ["diagram"]);
});

test("does not reclassify a status when its rendered details change", () => {
  const before = tweet.tweetFromParts({
    statusHref: "/openai/status/1234567890",
    author: "OpenAI",
    text: "A new model is here",
  });
  const after = tweet.tweetFromParts({
    statusHref: "/openai/status/1234567890",
    author: "OpenAI",
    text: "A new model is here 1K likes",
    media: ["Model diagram"],
  });
  assert.equal(before.signature, after.signature);
});

test("content-only posts get deterministic ids", () => {
  const first = tweet.tweetFromParts({ author: "A", text: "same" });
  const second = tweet.tweetFromParts({ author: "A", text: "same" });
  assert.equal(first.id, second.id);
  assert.equal(first.signature, second.signature);
});

test("filters only the home timeline", () => {
  assert.equal(tweet.isHomeFeed({ pathname: "/home" }), true);
  assert.equal(tweet.isHomeFeed({ pathname: "/home/" }), true);
  assert.equal(tweet.isHomeFeed({ pathname: "/openai" }), false);
  assert.equal(tweet.isHomeFeed({ pathname: "/search" }), false);
});
