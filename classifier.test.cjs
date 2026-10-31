"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const classifier = require("./classifier.js");

test("builds a cheap, non-reasoning structured Responses API request", () => {
  const request = classifier.buildRequest(
    { model: "gpt-5.6-luna", prompt: "Only distributed systems posts" },
    [{ id: "status:1", author: "Ada", text: "Raft notes", media: [] }],
  );

  assert.equal(request.model, "gpt-5.6-luna");
  assert.deepEqual(request.reasoning, { effort: "none" });
  assert.equal(request.store, false);
  assert.equal(request.text.format.type, "json_schema");
  assert.equal(request.text.format.strict, true);
  assert.match(request.instructions, /distributed systems/);
});

test("parses every expected decision from a raw Responses API payload", () => {
  const response = {
    output: [{
      type: "message",
      content: [{ type: "output_text", text: '{"decisions":[{"id":"a","include":true},{"id":"b","include":false}]}' }],
    }],
  };
  const result = classifier.parseResponse(response, ["a", "b"]);
  assert.equal(result.get("a"), true);
  assert.equal(result.get("b"), false);
});

test("rejects incomplete classifications", () => {
  assert.throws(
    () => classifier.parseResponse({ output_text: '{"decisions":[{"id":"a","include":true}]}' }, ["a", "b"]),
    /did not classify every post/,
  );
});

test("makes authentication and rate-limit errors actionable", () => {
  assert.match(classifier.apiErrorMessage(401, {}), /API key/);
  assert.match(classifier.apiErrorMessage(429, {}), /rate limit|spending limit/);
});
