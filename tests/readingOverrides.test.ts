import { strict as assert } from "node:assert";
import { test } from "node:test";
import { applyReadingOverrides, parseReadingOverrides } from "../src/engine/readingOverrides.ts";
import type { AnalyzerToken } from "../src/engine/tokens.ts";

function token(surface: string, readingKana: string): AnalyzerToken {
  return {
    surface,
    start: 0,
    end: surface.length,
    readingKana,
    partOfSpeech: "noun",
    morphologyFeatures: [],
    baseForm: surface,
    conjugationType: "",
    conjugationForm: "",
    oov: false,
    rawPos: ["名詞"],
  };
}

test("a hiragana reading is stored as katakana", () => {
  // The token contract is katakana, and nobody typing 春風=はるかぜ should have
  // to know that. Accepting either and normalizing is the whole reason this
  // parse step exists rather than reading the raw string.
  const overrides = parseReadingOverrides("春風=はるかぜ");
  assert.equal(overrides.get("春風"), "ハルカゼ");
  // Already katakana passes through unchanged.
  assert.equal(parseReadingOverrides("春風=ハルカゼ").get("春風"), "ハルカゼ");
});

test("blank lines, comments and whitespace are tolerated", () => {
  const overrides = parseReadingOverrides(
    ["# my list", "", "  春風 = はるかぜ  ", "\t常世=とこよ", "   "].join("\n"),
  );
  assert.equal(overrides.size, 2);
  assert.equal(overrides.get("春風"), "ハルカゼ");
  assert.equal(overrides.get("常世"), "トコヨ");
});

test("a malformed line is dropped without losing the rest", () => {
  // This text is typed by hand into a textarea. Rejecting the whole list over
  // one stray line would throw away work the user can see is mostly fine.
  //
  // 風= is deliberately the only entry for 風, and deliberately last. An earlier
  // version of this test wrote 常世= just above a good 常世=とこよ, so the valid
  // line overwrote the broken one and the assertion held either way — the
  // mutation `readingOverrides/accept-empty-reading` survived on it. A word with
  // no reading must be absent, not merely overwritten later.
  const overrides = parseReadingOverrides(
    ["春風=はるかぜ", "no equals sign here", "=とこよ", "常世=とこよ", "風="].join("\n"),
  );
  assert.equal(overrides.size, 2);
  assert.equal(overrides.get("春風"), "ハルカゼ");
  assert.equal(overrides.get("常世"), "トコヨ");
  // Not just missing from the count: absent, so it can never reach a token.
  assert.equal(overrides.has("風"), false);
});

test("an empty reading never blanks a word", () => {
  // What the guard actually prevents, stated as behaviour rather than parsing:
  // an accepted 風= would set readingKana to "", which is the analyzer's
  // abstention signal, and the word would silently lose its furigana.
  const got = applyReadingOverrides([token("風", "カゼ")], parseReadingOverrides("風="));
  assert.equal(got[0]?.readingKana, "カゼ");
});

test("an override replaces the reading the analyzer produced", () => {
  // The opposite of applyJmdictReadings, which only fills abstentions. Here the
  // analyzer's answer is exactly what the user is disagreeing with: Sudachi
  // reads 春風 as シュンプウ and both readings are real.
  const tokens = [token("春風", "シュンプウ"), token("が", "ガ")];
  const got = applyReadingOverrides(tokens, parseReadingOverrides("春風=はるかぜ"));
  assert.equal(got[0]?.readingKana, "ハルカゼ");
  assert.equal(got[1]?.readingKana, "ガ");
});

test("matching is on the whole surface, never a substring", () => {
  // 春風亭 is a rakugo stage name, and nothing in the surface says whether the
  // 春風 inside it is the user's word. A substring rule would rewrite it with no
  // way to notice; failing to match is visible and correctable.
  const got = applyReadingOverrides(
    [token("春風亭", "シュンプウテイ")],
    parseReadingOverrides("春風=はるかぜ"),
  );
  assert.equal(got[0]?.readingKana, "シュンプウテイ");
});

test("an empty list changes nothing and an unlisted word is untouched", () => {
  const tokens = [token("春風", "シュンプウ")];
  assert.deepEqual(applyReadingOverrides(tokens, new Map()), tokens);
  assert.deepEqual(applyReadingOverrides(tokens, parseReadingOverrides("常世=とこよ")), tokens);
});

test("an override matching the analyzer leaves the token identical", () => {
  // Not just equal — the same object, so an entry that agrees with the
  // dictionary costs nothing downstream.
  const tokens = [token("春風", "ハルカゼ")];
  const got = applyReadingOverrides(tokens, parseReadingOverrides("春風=はるかぜ"));
  assert.equal(got[0], tokens[0]);
});
