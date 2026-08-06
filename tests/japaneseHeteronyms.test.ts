import { strict as assert } from "node:assert";
import { test } from "node:test";
import { applyHeteronymDefaults } from "../src/engine/japaneseHeteronyms.ts";
import type { AnalyzerToken } from "../src/engine/tokens.ts";

/**
 * Readings here are what `analyze` really returns, not what reads well.
 * Sudachi gives ワタクシ for every bare 私 and ナン for every bare 何 — that is
 * the input this module exists to correct, so inventing gentler tokens would
 * be testing a situation that never occurs.
 */
function token(surface: string, readingKana: string, start = 0): AnalyzerToken {
  return {
    surface,
    start,
    end: start + surface.length,
    readingKana,
    partOfSpeech: "pronoun",
    morphologyFeatures: [],
    baseForm: surface,
    conjugationType: "",
    conjugationForm: "",
    rawPos: ["代名詞"],
    oov: false,
  };
}

const readings = (tokens: readonly AnalyzerToken[]) =>
  applyHeteronymDefaults(tokens).map((t) => t.readingKana);

test("a lone 私 reads わたし, never the formal わたくし", () => {
  // Bad Apple!! lands this six times in 27 lines; 12 of 12 in the wider corpus.
  for (const next of ["は", "が", "の", "から"]) {
    assert.deepEqual(
      readings([token("私", "ワタクシ"), token(next, "ハ", 1)])[0],
      "ワタシ",
      `私${next}`,
    );
  }
  assert.deepEqual(readings([token("私", "ワタクシ")])[0], "ワタシ", "line-final");
});

test("私たち is left alone, because it never arrives as a lone 私", () => {
  assert.deepEqual(readings([token("私たち", "ワタシタチ")]), ["ワタシタチ"]);
});

test("何 assimilates to a following coronal and stays なん", () => {
  for (const next of ["だ", "で", "と", "の", "て"]) {
    assert.equal(
      readings([token("何", "ナン"), token(next, "ダ", 1)])[0],
      "ナン",
      `何${next}`,
    );
  }
});

test("何 before anything else reads なに", () => {
  // The measured failures: 何を, 何か, 何も all came back ナン.
  for (const next of ["を", "も", "が", "か", "は", "より"]) {
    assert.equal(
      readings([token("何", "ナン"), token(next, "ヲ", 1)])[0],
      "ナニ",
      `何${next}`,
    );
  }
});

test("何 followed by kanji keeps なん, since 何人 is なんにん", () => {
  assert.equal(readings([token("何", "ナン"), token("人", "ニン", 1)])[0], "ナン");
});

test("a bare 何 with nothing after it is the interrogative なに", () => {
  assert.equal(readings([token("何", "ナン")])[0], "ナニ");
});

test("a reading that is already right is not rewritten", () => {
  // 何度 arrives as its own compound reading ナンド and must survive untouched.
  assert.deepEqual(readings([token("何度", "ナンド")]), ["ナンド"]);
  // And an analyzer that one day returns ナニ itself must not be flipped back.
  assert.deepEqual(readings([token("何", "ナニ"), token("も", "モ", 1)]), ["ナニ", "モ"]);
});

test("tokens needing no change are passed through unchanged", () => {
  const untouched = [token("空", "ソラ"), token("は", "ハ", 1)];
  const out = applyHeteronymDefaults(untouched);
  assert.equal(out[0], untouched[0], "same reference, not a copy");
  assert.equal(out[1], untouched[1]);
});
