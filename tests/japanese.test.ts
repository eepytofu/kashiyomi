import { strict as assert } from "node:assert";
import { test } from "node:test";
import { annotateJapaneseLine } from "../src/engine/japanese.ts";
import type { AnalyzerToken } from "../src/engine/tokens.ts";

/**
 * `rawPos` used to be left empty here, and the analyzer never returns that —
 * every real token carries at least a top-level class. Word joining reads
 * `rawPos`, so with it empty these fixtures described a tokenization nobody can
 * get, and the romaji they asserted was unreachable. It is defaulted from
 * `partOfSpeech` now, and passed explicitly where the second field matters
 * (助詞,接続助詞 is the te-form; 助詞,格助詞 is not).
 */
const POS_TO_RAW: Record<AnalyzerToken["partOfSpeech"], string> = {
  noun: "名詞",
  pronoun: "代名詞",
  verb: "動詞",
  auxiliaryVerb: "助動詞",
  particle: "助詞",
  suffix: "接尾辞",
  other: "",
};

function token(
  surface: string,
  start: number,
  readingKana: string,
  partOfSpeech: AnalyzerToken["partOfSpeech"] = "noun",
  rawPos: readonly string[] = [POS_TO_RAW[partOfSpeech]],
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
    rawPos,
  };
}

test("furigana and romaji for a plain line", () => {
  // Tokens verified against the real analyzer, re-checked 2026-08-06 for the
  // second POS field:  analyze "灯篭の灯に照らされてゆく"
  // An earlier version read 灯 as ヒ, which Sudachi does not return here — it
  // reads アカリ — so the asserted romaji was for a tokenization the user
  // never gets. の and に are 格助詞 while て is 接続助詞, and only the last of
  // those three joins the word before it.
  const line = "灯篭の灯に照らされてゆく";
  const tokens = [
    token("灯篭", 0, "トウロウ"),
    token("の", 2, "ノ", "particle", ["助詞", "格助詞"]),
    token("灯", 3, "アカリ"),
    token("に", 4, "ニ", "particle", ["助詞", "格助詞"]),
    token("照らさ", 5, "テラサ", "verb"),
    token("れ", 8, "レ", "auxiliaryVerb"),
    token("て", 9, "テ", "particle", ["助詞", "接続助詞"]),
    token("ゆく", 10, "ユク", "verb"),
  ];
  const { furigana, romaji } = annotateJapaneseLine(line, tokens);
  assert.deepEqual(furigana, [
    { start: 0, end: 2, reading: "とうろう", origin: "inferred" },
    { start: 3, end: 4, reading: "あかり", origin: "inferred" },
    { start: 5, end: 6, reading: "て", origin: "inferred" },
  ]);
  // 照らさ + れ + て is one word: the auxiliary joins the verb and the te-form
  // joins that. It read "terasa re te yuku" until 2026-08-06.
  assert.equal(romaji, "tourou no akari ni terasarete yuku");
});

test("an inflected verb is one romaji word", () => {
  // Every one of these came out in pieces — `wasure ta`, `sumi mase n` — because
  // the row spaced one analyzer token at a time. POS and readings below are the
  // analyzer's own, checked 2026-08-06.
  const wasureta = annotateJapaneseLine("忘れた", [
    token("忘れ", 0, "ワスレ", "verb"),
    token("た", 2, "タ", "auxiliaryVerb"),
  ]);
  assert.equal(wasureta.romaji, "wasureta");

  const sumimasen = annotateJapaneseLine("済みません", [
    token("済み", 0, "スミ", "verb"),
    token("ませ", 2, "マセ", "auxiliaryVerb"),
    token("ん", 4, "ン", "auxiliaryVerb"),
  ]);
  assert.equal(sumimasen.romaji, "sumimasen");

  // Auxiliary onto auxiliary, which is why 助動詞 is in the previous-token set.
  const tabetakatta = annotateJapaneseLine("食べたかった", [
    token("食べ", 0, "タベ", "verb"),
    token("たかっ", 2, "タカッ", "auxiliaryVerb"),
    token("た", 5, "タ", "auxiliaryVerb"),
  ]);
  assert.equal(tabetakatta.romaji, "tabetakatta");
});

test("the copula stays a word of its own", () => {
  // 早いです is the case that actually tests the です exclusion. 早い is 形容詞,
  // which *is* in the previous-token set, so nothing else stops the join: drop
  // the exclusion and this reads `hayaidesu`.
  //
  // Caught by `japanese/copula-joins`, which survived a sweep because the 学生
  // case below passes for the wrong reason — 学生 is a noun, so the
  // previous-token condition rejects it before です is ever considered. Two
  // assertions that look like one test of one rule; only this one exercises it.
  const hayai = annotateJapaneseLine("早いです", [
    token("早い", 0, "ハヤイ", "other", ["形容詞"]),
    token("です", 2, "デス", "auxiliaryVerb"),
  ]);
  assert.equal(hayai.romaji, "hayai desu");

  const desu = annotateJapaneseLine("学生です", [
    token("学生", 0, "ガクセイ"),
    token("です", 2, "デス", "auxiliaryVerb"),
  ]);
  assert.equal(desu.romaji, "gakusei desu");

  // 学生だった is the case a rule keyed only on 助動詞 gets wrong: だっ follows a
  // noun, so it starts a word, and た then joins だっ rather than 学生.
  const datta = annotateJapaneseLine("学生だった", [
    token("学生", 0, "ガクセイ"),
    token("だっ", 2, "ダッ", "auxiliaryVerb"),
    token("た", 4, "タ", "auxiliaryVerb"),
  ]);
  assert.equal(datta.romaji, "gakusei datta");
});

test("the te-form joins, other conjunctive particles do not", () => {
  const tabete = annotateJapaneseLine("食べている", [
    token("食べ", 0, "タベ", "verb"),
    token("て", 2, "テ", "particle", ["助詞", "接続助詞"]),
    token("いる", 3, "イル", "verb"),
  ]);
  assert.equal(tabete.romaji, "tabete iru");

  // けれど carries the identical tag and must not join. This is the case that
  // ruled out matching 接続助詞 as a class instead of the two te-form surfaces.
  const keredo = annotateJapaneseLine("行くけれど", [
    token("行く", 0, "イク", "verb"),
    token("けれど", 2, "ケレド", "particle", ["助詞", "接続助詞"]),
  ]);
  assert.equal(keredo.romaji, "iku keredo");
});

test("a prefix binds to the word after it", () => {
  const ohana = annotateJapaneseLine("お花", [
    token("お", 0, "オ", "other", ["接頭辞"]),
    token("花", 1, "ハナ"),
  ]);
  assert.equal(ohana.romaji, "ohana");
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
