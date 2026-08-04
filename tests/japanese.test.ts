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
  // Tokens verified against the real analyzer on 2026-08-03:
  //   native/target/release/analyze "灯篭の灯に照らされてゆく"
  // An earlier version read 灯 as ヒ, which Sudachi does not return here — it
  // reads アカリ — so the asserted romaji was for a tokenization the user
  // never gets.
  const line = "灯篭の灯に照らされてゆく";
  const tokens = [
    token("灯篭", 0, "トウロウ"),
    token("の", 2, "ノ", "particle"),
    token("灯", 3, "アカリ"),
    token("に", 4, "ニ", "particle"),
    token("照らさ", 5, "テラサ", "verb"),
    token("れ", 8, "レ", "auxiliaryVerb"),
    token("て", 9, "テ", "particle"),
    token("ゆく", 10, "ユク", "verb"),
  ];
  const { furigana, romaji } = annotateJapaneseLine(line, tokens);
  assert.deepEqual(furigana, [
    { start: 0, end: 2, reading: "とうろう", origin: "inferred" },
    { start: 3, end: 4, reading: "あかり", origin: "inferred" },
    { start: 5, end: 6, reading: "て", origin: "inferred" },
  ]);
  assert.equal(romaji, "tourou no akari ni terasa re te yuku");
});

test("authored hint overrides reading and romaji", () => {
  const line = "天へ";
  const tokens = [token("天", 0, "テン"), token("へ", 1, "ヘ", "particle")];
  const { furigana, romaji, romajiSegments } = annotateJapaneseLine(line, tokens, [
    { start: 0, end: 1, reading: "そら" },
  ]);
  assert.deepEqual(furigana, [{ start: 0, end: 1, reading: "そら", origin: "authored" }]);
  assert.equal(romaji, "sora e");
  assert.deepEqual(romajiSegments, [
    { text: "sora", origin: "authored" },
    { text: " e", origin: "inferred" },
  ]);
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
  // Deliberately constructed, not a real tokenization: Sudachi returns 大空 as
  // a single オオゾラ token. The split exists to exercise a hint that crosses a
  // token boundary, which does happen on compounds the dictionary does split.
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

test("cjk punctuation becomes latin punctuation", () => {
  // Romaji is Latin-script orthography, so 、 romanizes as a comma and takes
  // Latin spacing: nothing before it, one space after. Keeping 、 also looked
  // wrong for a second reason — the fullwidth glyph carries its own advance
  // width, which is what makes it need no spaces in the Japanese line.
  const line = "そら、うみ";
  const tokens = [
    token("そら", 0, "ソラ", "pronoun"),
    token("、", 2, ""),
    token("うみ", 3, "ウミ"),
  ];
  const { romaji } = annotateJapaneseLine(line, tokens);
  assert.equal(romaji, "sora, umi");
});

test("line-final punctuation leaves no trailing space", () => {
  const line = "そら。";
  const tokens = [token("そら", 0, "ソラ", "pronoun"), token("。", 2, "")];
  assert.equal(annotateJapaneseLine(line, tokens).romaji, "sora.");
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

test("the topic particle は voices as wa", () => {
  const line = "僕は空";
  const tokens = [
    token("僕", 0, "ボク", "pronoun"),
    token("は", 1, "ハ", "particle"),
    token("空", 2, "ソラ"),
  ];
  assert.equal(annotateJapaneseLine(line, tokens).romaji, "boku wa sora");
});

test("the object particle を voices as wo", () => {
  const line = "空を";
  const tokens = [token("空", 0, "ソラ"), token("を", 1, "ヲ", "particle")];
  assert.equal(annotateJapaneseLine(line, tokens).romaji, "sora wo");
});

test("は outside a particle keeps its own sound", () => {
  // Only the particle is respelled. A は the analyzer did not tag as one is
  // read normally, so the Hepburn rule must stay gated on part of speech.
  const tokens = [token("は", 0, "ハ", "noun")];
  assert.equal(annotateJapaneseLine("は", tokens).romaji, "ha");
});

test("a hint with non-kana context around it is voiced alone", () => {
  // The hint covers 空 only, but its token run starts at 大, and 大's sound
  // cannot be reconstructed from the display text. Voicing the run would
  // splice a kanji into the romaji, so the authored reading stands by itself.
  const line = "大空へ";
  const tokens = [token("大空", 0, "オオゾラ"), token("へ", 2, "ヘ", "particle")];
  const { romaji } = annotateJapaneseLine(line, tokens, [{ start: 1, end: 2, reading: "ぞら" }]);
  assert.equal(romaji, "zora e");
});

test("mismatched tokens fail closed", () => {
  assert.throws(() => annotateJapaneseLine("天へ", [token("地", 0, "チ")]));
});

test("the numeral reader only fills abstentions, never overrides the analyzer", () => {
  // SudachiDict reads 一人 as ヒトリ on its own. The numeral module must not
  // recompute a token that already has a reading, or a dictionary reading the
  // rules do not know would be silently replaced. Synthetic reading here so the
  // two paths would visibly differ.
  const line = "三人";
  const tokens = [token("三人", 0, "サンニン")];
  assert.equal(annotateJapaneseLine(line, tokens).romaji, "sannin");

  const odd = [token("三", 0, "ミ"), token("人", 1, "ニン", "suffix")];
  const got = annotateJapaneseLine(line, odd);
  assert.equal(got.romaji, "mi nin", "an analyzer reading wins over the rule");
  assert.notEqual(got.romaji, "sannin");
});

test("a numeral the analyzer abstained on is read by rule", () => {
  // What SudachiDict actually returns for 三人: 数詞 with no reading, then the
  // counter. Before the numeral module this voiced as "三 nin".
  const line = "三人";
  const tokens = [token("三", 0, ""), token("人", 1, "ニン", "suffix")];
  const got = annotateJapaneseLine(line, tokens);
  assert.equal(got.romaji, "sannin");
  assert.deepEqual(got.furigana, [{ start: 0, end: 2, reading: "さんにん", origin: "inferred" }]);
});

test("no space is inserted before closing punctuation", () => {
  // 言葉、夢 — tokens from the real analyzer 2026-08-05:
  //   言葉[コトバ]@0-2 、[∅]@2-3 夢[ユメ]@3-4
  // 、 latinizes to a comma, and a comma preceded by a space reads as a typo.
  //
  // This pins the output, not the guard. `NO_SPACE_BEFORE` in appendRomaji is
  // redundant: latinizeSegments strips a space before any closing mark anyway,
  // so removing the guard changes nothing (verified over 69 lines). The test
  // still earns its place — it would catch a regression in latinizeSegments,
  // which is now the only thing holding this up.
  const line = "言葉、夢";
  const tokens = [token("言葉", 0, "コトバ"), token("、", 2, ""), token("夢", 3, "ユメ")];
  assert.equal(annotateJapaneseLine(line, tokens).romaji, "kotoba, yume");
});

test("no space is inserted after opening punctuation", () => {
  // 「言葉」 — 「[∅]@0-1 言葉[コトバ]@1-3 」[∅]@3-4, latinized to quotes.
  // Pins NO_SPACE_AFTER; without it the row renders '" kotoba"'.
  const line = "「言葉」";
  const tokens = [token("「", 0, ""), token("言葉", 1, "コトバ"), token("」", 3, "")];
  assert.equal(annotateJapaneseLine(line, tokens).romaji, "\"kotoba\"");
});

test("a token that voices to nothing still separates its neighbours", () => {
  // 夢ー空 — the analyzer emits ー as its own token (夢[∅] ー[ー] 空[ソラ]) and
  // kanaToRomaji("ー") returns "": a lone prolonged sound mark has nothing to
  // voice. Appending it anyway overwrites the separator its neighbours needed,
  // and the row renders "夢sora" with the words run together.
  const line = "夢ー空";
  const tokens = [token("夢", 0, ""), token("ー", 1, "ー"), token("空", 2, "ソラ")];
  const out = annotateJapaneseLine(line, tokens);
  assert.equal(out.romaji, "夢 sora");
  // Asserted exactly, not just "no empty text". Dropping the guard pushes a
  // filler part for ー, and latinizeSegments then collapses the spacing so the
  // joined line still reads "夢 sora" — the only surviving evidence is the
  // extra segment, and the renderer walks segments, not the joined string.
  assert.deepEqual(out.romajiSegments, [
    { text: "夢", origin: "inferred" },
    { text: " sora", origin: "inferred" },
  ]);
});


test("furigana segments come back in document order", () => {
  // 大胆不敵に ハイカラ革命 (千本桜), tokens from the real analyzer 2026-08-05.
  // The renderer walks segments left to right and slices the untouched text
  // between them, so an out-of-order list does not merely look wrong — it
  // interleaves ruby with the wrong characters. Nothing pinned this before:
  // reversing the sort changed the output and every test still passed.
  const line = "大胆不敵に ハイカラ革命";
  const tokens = [
    token("大胆", 0, "ダイタン"),
    token("不敵", 2, "フテキ"),
    token("に", 4, "ニ", "particle"),
    token(" ", 5, ""),
    token("ハイカラ", 6, "ハイカラ"),
    token("革命", 10, "カクメイ"),
  ];
  const { furigana } = annotateJapaneseLine(line, tokens);
  assert.deepEqual(
    furigana.map((s) => [s.start, s.end, s.reading]),
    [[0, 2, "だいたん"], [2, 4, "ふてき"], [10, 12, "かくめい"]],
  );
  for (let i = 1; i < furigana.length; i++) {
    assert.ok(furigana[i]!.start >= furigana[i - 1]!.end, "segments must not overlap or regress");
  }
});
