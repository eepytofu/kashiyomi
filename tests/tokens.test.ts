import { strict as assert } from "node:assert";
import { test } from "node:test";
import { assertAnalyzerTokens, type AnalyzerToken } from "../src/engine/tokens.ts";

function token(overrides: Partial<AnalyzerToken>): AnalyzerToken {
  return {
    surface: "",
    start: 0,
    end: 0,
    readingKana: "",
    partOfSpeech: "other",
    morphologyFeatures: [],
    baseForm: "",
    conjugationType: "",
    conjugationForm: "",
    oov: false,
    rawPos: [],
    ...overrides,
  };
}

test("accepts a valid tiling", () => {
  assertAnalyzerTokens("天へ", [
    token({ surface: "天", start: 0, end: 1 }),
    token({ surface: "へ", start: 1, end: 2 }),
  ]);
});

test("rejects overlapping ranges", () => {
  assert.throws(() =>
    assertAnalyzerTokens("天へ", [
      token({ surface: "天", start: 0, end: 1 }),
      token({ surface: "天へ", start: 0, end: 2 }),
    ]),
  );
});

test("rejects surface mismatch", () => {
  assert.throws(() =>
    assertAnalyzerTokens("天へ", [token({ surface: "地", start: 0, end: 1 })]),
  );
});

test("rejects out-of-bounds ranges", () => {
  assert.throws(() =>
    assertAnalyzerTokens("天", [token({ surface: "天へ", start: 0, end: 2 })]),
  );
});

test("rejects non-integer offsets", () => {
  // The offsets cross the JS/Rust boundary as JSON numbers, so a malformed
  // payload can carry a float. slice() would silently truncate it and every
  // ruby after that point would sit one character off.
  assert.throws(
    () => assertAnalyzerTokens("夢見", [token({ surface: "夢", start: 0, end: 1.5 })]),
    /non-integer/,
  );
  assert.throws(
    () => assertAnalyzerTokens("夢見", [token({ surface: "夢", start: NaN, end: 1 })]),
    /non-integer/,
  );
});
