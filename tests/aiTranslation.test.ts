import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildTranslationPrompt,
  parseTranslationResponse,
  shouldDisplayTranslation,
  translationCacheKey,
} from "../src/engine/aiTranslation.ts";

test("prompt numbers every line and states the count", () => {
  const { system, user } = buildTranslationPrompt(
    ["灯篭の灯に照らされてゆく", "幸せな日々に消えてゆく"],
    "English",
    { title: "桜花繚乱", artist: "初音ミク" },
  );
  assert.match(system, /JSON array of 2 strings/);
  assert.match(user, /Song: 桜花繚乱/);
  assert.match(user, /1\. 灯篭の灯に照らされてゆく/);
  assert.match(user, /2\. 幸せな日々に消えてゆく/);
});

test("custom instructions land in the system prompt", () => {
  const { system } = buildTranslationPrompt(["a"], "English", {}, "Prefer poetic phrasing.");
  assert.match(system, /Prefer poetic phrasing\./);
});

test("parses a clean JSON array", () => {
  assert.deepEqual(parseTranslationResponse('["one", "two"]', 2), ["one", "two"]);
});

test("parses arrays wrapped in code fences or prose", () => {
  assert.deepEqual(parseTranslationResponse('```json\n["one", "two"]\n```', 2), ["one", "two"]);
  assert.deepEqual(parseTranslationResponse('Here you go: ["one", "two"]', 2), ["one", "two"]);
});

test("strips echoed line numbering", () => {
  assert.deepEqual(parseTranslationResponse('["9. 导唱协力：小缘", "10. 出品：拜年纪"]', 2), [
    "导唱协力：小缘",
    "出品：拜年纪",
  ]);
});

test("rejects wrong counts and non-strings", () => {
  assert.equal(parseTranslationResponse('["one"]', 2), undefined);
  assert.equal(parseTranslationResponse('["one", 2]', 2), undefined);
  assert.equal(parseTranslationResponse("not json at all", 1), undefined);
});

test("identical translations are suppressed", () => {
  assert.equal(shouldDisplayTranslation("La la la!", "la la la"), false);
  assert.equal(shouldDisplayTranslation("灯篭", "Stone lantern"), true);
  assert.equal(shouldDisplayTranslation("a", ""), false);
});

test("cache key changes with any configuration input", () => {
  const base = translationCacheKey(["a", "b"], "openai", "m1", "English", "");
  assert.notEqual(base, translationCacheKey(["a", "c"], "openai", "m1", "English", ""));
  assert.notEqual(base, translationCacheKey(["a", "b"], "gemini", "m1", "English", ""));
  assert.notEqual(base, translationCacheKey(["a", "b"], "openai", "m2", "English", ""));
  assert.notEqual(base, translationCacheKey(["a", "b"], "openai", "m1", "Indonesian", ""));
  assert.notEqual(base, translationCacheKey(["a", "b"], "openai", "m1", "English", "poetic"));
});
