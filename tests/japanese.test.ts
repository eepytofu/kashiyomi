import { strict as assert } from "node:assert";
import { test } from "node:test";
import { annotateJapaneseLine } from "../src/engine/japanese.ts";
import type { AnalyzerToken } from "../src/engine/tokens.ts";

function token(
  surface: string,
  start: number,
  readingKana: string,
  partOfSpeech: AnalyzerToken["partOfSpeech"] = "noun",
): AnalyzerToken {
  return {
    surface,
    start,
    end: start + surface.length,
    readingKana,
    partOfSpeech,
    morphologyFeatures: [],
    baseForm: surface,
    conjugationType: "",
    conjugationForm: "",
    oov: false,
    rawPos: [],
  };
}

test("furigana and romaji for a plain line", () => {
  const line = "灯篭の灯に照らされてゆく";
  const tokens = [
    token("灯篭", 0, "トウロウ"),
    token("の", 2, "ノ", "particle"),
    token("灯", 3, "ヒ"),
    token("に", 4, "ニ", "particle"),
    token("照らさ", 5, "テラサ", "verb"),
    token("れ", 8, "レ", "auxiliaryVerb"),
    token("て", 9, "テ", "particle"),
    token("ゆく", 10, "ユク", "verb"),
  ];
  const { furigana, romaji } = annotateJapaneseLine(line, tokens);
  assert.deepEqual(furigana, [
    { start: 0, end: 2, reading: "とうろう", origin: "inferred" },
    { start: 3, end: 4, reading: "ひ", origin: "inferred" },
    { start: 5, end: 6, reading: "て", origin: "inferred" },
  ]);
  assert.equal(romaji, "tourou no hi ni terasa re te yuku");
});

test("authored hint overrides reading and romaji", () => {
  const line = "天へ";
  const tokens = [token("天", 0, "テン"), token("へ", 1, "ヘ", "particle")];
  const { furigana, romaji } = annotateJapaneseLine(line, tokens, [
    { start: 0, end: 1, reading: "そら" },
  ]);
  assert.deepEqual(furigana, [{ start: 0, end: 1, reading: "そら", origin: "authored" }]);
  assert.equal(romaji, "sora e");
});

test("hint over kanji keeps token okurigana sound", () => {
  const line = "煌めく";
  const tokens = [token("煌めく", 0, "キラメク", "verb")];
  const { furigana, romaji } = annotateJapaneseLine(line, tokens, [
    { start: 0, end: 1, reading: "ひか" },
  ]);
  assert.deepEqual(furigana, [{ start: 0, end: 1, reading: "ひか", origin: "authored" }]);
  assert.equal(romaji, "hikameku");
});

test("okurigana-carrying hint puts ruby only over the kanji", () => {
  const line = "思ゆ桜";
  const tokens = [token("思ゆ", 0, ""), token("桜", 2, "サクラ")];
  const { furigana, romaji } = annotateJapaneseLine(line, tokens, [
    { start: 0, end: 2, reading: "おぼゆ" },
  ]);
  assert.deepEqual(furigana, [
    { start: 0, end: 1, reading: "おぼ", origin: "authored" },
    { start: 2, end: 3, reading: "さくら", origin: "inferred" },
  ]);
  assert.equal(romaji, "oboyu sakura");
});

test("hint spanning two tokens is voiced once", () => {
  const line = "大空へ";
  const tokens = [token("大", 0, "オオ"), token("空", 1, "ソラ"), token("へ", 2, "ヘ", "particle")];
  const { furigana, romaji } = annotateJapaneseLine(line, tokens, [
    { start: 0, end: 2, reading: "おおぞら" },
  ]);
  assert.deepEqual(furigana, [{ start: 0, end: 2, reading: "おおぞら", origin: "authored" }]);
  assert.equal(romaji, "oozora e");
});

test("unknown readings abstain from furigana but keep the line", () => {
  const line = "天へ";
  const tokens = [token("天", 0, ""), token("へ", 1, "ヘ", "particle")];
  const { furigana, romaji } = annotateJapaneseLine(line, tokens);
  assert.deepEqual(furigana, []);
  assert.equal(romaji, "天 e");
});

test("no space before punctuation", () => {
  const line = "そら、うみ";
  const tokens = [
    token("そら", 0, "ソラ"),
    token("、", 2, ""),
    token("うみ", 3, "ウミ"),
  ];
  const { romaji } = annotateJapaneseLine(line, tokens);
  assert.equal(romaji, "sora、umi");
});

test("sokuon carries across token boundaries", () => {
  const line = "回って";
  const tokens = [token("回っ", 0, "マワッ", "verb"), token("て", 2, "テ", "particle")];
  const { romaji } = annotateJapaneseLine(line, tokens);
  assert.equal(romaji, "mawatte");
});

test("line-final sokuon still voices as t", () => {
  const line = "あっ";
  const tokens = [token("あっ", 0, "アッ", "other")];
  const { romaji } = annotateJapaneseLine(line, tokens);
  assert.equal(romaji, "at");
});

test("mismatched tokens fail closed", () => {
  assert.throws(() => annotateJapaneseLine("天へ", [token("地", 0, "チ")]));
});
