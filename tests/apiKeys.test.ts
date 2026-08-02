import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isKeyExhaustedStatus, orderApiKeys, parseApiKeys } from "../src/engine/apiKeys.ts";

test("parses keys separated by newlines or commas", () => {
  assert.deepEqual(parseApiKeys("key-a\nkey-b\nkey-c"), ["key-a", "key-b", "key-c"]);
  assert.deepEqual(parseApiKeys("key-a, key-b ,key-c"), ["key-a", "key-b", "key-c"]);
  assert.deepEqual(parseApiKeys("  key-a  "), ["key-a"]);
  assert.deepEqual(parseApiKeys("\n\n"), []);
});

test("single key needs no rotation", () => {
  assert.deepEqual(orderApiKeys(["only"], 0, new Map(), 0), ["only"]);
});

test("rotation resumes after the last working key", () => {
  const keys = ["a", "b", "c"];
  assert.deepEqual(orderApiKeys(keys, 0, new Map(), 0), ["a", "b", "c"]);
  assert.deepEqual(orderApiKeys(keys, 1, new Map(), 0), ["b", "c", "a"]);
  assert.deepEqual(orderApiKeys(keys, 2, new Map(), 0), ["c", "a", "b"]);
});

test("resting keys are tried last but not dropped", () => {
  const keys = ["a", "b", "c"];
  const cooldown = new Map([["a", 5_000]]);
  assert.deepEqual(orderApiKeys(keys, 0, cooldown, 1_000), ["b", "c", "a"]);
  // Once the cooldown lapses the normal order returns.
  assert.deepEqual(orderApiKeys(keys, 0, cooldown, 6_000), ["a", "b", "c"]);
});

test("all keys resting still yields every key", () => {
  const keys = ["a", "b"];
  const cooldown = new Map([
    ["a", 9_000],
    ["b", 9_000],
  ]);
  assert.deepEqual(orderApiKeys(keys, 0, cooldown, 1_000).sort(), ["a", "b"]);
});

test("statuses that justify trying another key", () => {
  for (const status of [401, 402, 403, 429]) {
    assert.equal(isKeyExhaustedStatus(status), true, String(status));
  }
  for (const status of [200, 400, 404, 500, 503]) {
    assert.equal(isKeyExhaustedStatus(status), false, String(status));
  }
});
