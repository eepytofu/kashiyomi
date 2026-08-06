import { strict as assert } from "node:assert";
import { test } from "node:test";
import { applyJmdictReadings, jmdictReadings } from "../src/engine/jmdictReadings.ts";
import { assertAnalyzerTokens, type AnalyzerToken } from "../src/engine/tokens.ts";

function token(
  surface: string,
  start: number,
  readingKana: string,
  baseForm = surface,
): AnalyzerToken {
  return {
    surface,
    start,
    end: start + surface.length,
    readingKana,
    partOfSpeech: "noun",
    morphologyFeatures: [],
    baseForm,
    conjugationType: "",
    conjugationForm: "",
    oov: false,
    rawPos: [],
  };
}

// Readings as the exported asset holds them: hiragana, one per surface. Every
// entry here was read out of the real asset rather than typed from memory.
const readings = jmdictReadings({
  磊々: "らいらい",
  常世: "とこよ",
  常磐: "ときわ",
  秋桜: "あきざくら",
  走り抜ける: "はしりぬける",
  灯篭: "とうろう",
});

test("rule 1 fills an abstention", () => {
  // 磊々 is genuinely OOV for SudachiDict while 落々 beside it resolves as
  // ラクラク, so the line rendered with ruby on one half only.
  const [got] = applyJmdictReadings([token("磊々", 0, "")], readings);
  assert.equal(got!.readingKana, "ライライ");
});

test("a filled reading is katakana, matching the token contract", () => {
  // AnalyzerToken documents readingKana as the katakana reading; the asset
  // stores hiragana. Leaking hiragana here would still render, because
  // everything downstream normalizes, and would quietly break that contract.
  const [got] = applyJmdictReadings([token("常世", 0, "")], readings);
  assert.equal(got!.readingKana, "トコヨ");
});

test("a reading the analyzer produced is never overridden", () => {
  // The rejected override rule would have rewritten this. 常磐 alone reads
  // ジョウバン, but inside 秋桜が咲く常磐の道 Sudachi reads トキワ unaided —
  // the "error" is an artifact of analyzing a bare word as a whole line, and
  // lyrics are always analyzed as full lines.
  const got = applyJmdictReadings([token("常磐", 0, "ジョウバン")], readings);
  assert.equal(got[0]!.readingKana, "ジョウバン");
});

test("a surface whose other reading JMdict omits is left alone", () => {
  // 秋桜 is the case that killed the override rule. JMdict records only
  // あきざくら; コスモス is equally real and is what a lyric means. JMdict
  // holding one reading means JMdict records one, not that the language has one.
  const got = applyJmdictReadings([token("秋桜", 0, "コスモス")], readings);
  assert.equal(got[0]!.readingKana, "コスモス");
});

test("an inflected surface is left alone", () => {
  // JMdict lists lemmas: for 走り抜け it holds はしりぬける. Filling only
  // abstentions already prevents this, but the case is pinned because any
  // future override rule would have to handle it.
  const tokens = [token("走り抜け", 0, "ハシリヌケ", "走り抜ける")];
  const got = applyJmdictReadings(tokens, readings);
  assert.equal(got[0]!.readingKana, "ハシリヌケ");
});

test("a surface with several readings is not in the asset, so nothing happens", () => {
  // The safety property is structural: 春風 (はるかぜ/しゅんぷう), 空 (から/
  // そら/うろ/くう) and 僕 (しもべ/ぼく/...) are excluded at build time, so no
  // lookup can rewrite 空 to から. Nothing here is special-cased by name.
  const tokens = [token("春風", 0, "シュンプウ"), token("空", 2, "ソラ"), token("僕", 3, "ボク")];
  const got = applyJmdictReadings(tokens, readings);
  assert.equal(got[0]!.readingKana, "シュンプウ");
  assert.equal(got[1]!.readingKana, "ソラ");
  assert.equal(got[2]!.readingKana, "ボク");
});

test("an agreeing reading is left as the analyzer gave it", () => {
  const got = applyJmdictReadings([token("灯篭", 0, "トウロウ")], readings);
  assert.equal(got[0]!.readingKana, "トウロウ");
});

test("kana-only surfaces are never looked up", () => {
  // For a kana surface there is nothing to supply — the reading is the surface —
  // and looking one up can only *change* it. JMdict maps 行く to いく, so a bare
  // ゆく the analyzer abstained on would come back イク, silently respelling the
  // lyric's own kana. The lookup table below deliberately contains ゆく so this
  // test fails if the kanji guard is removed; without that entry it passed
  // whether the guard was there or not.
  const kana = jmdictReadings({ ゆく: "いく" });
  const got = applyJmdictReadings([token("ゆく", 0, ""), token("の", 2, "ノ")], kana);
  assert.equal(got[0]!.readingKana, "", "a kana surface stays as the analyzer left it");
  assert.equal(got[1]!.readingKana, "ノ");
});

test("ranges survive, so the fail-closed validator still accepts the stream", () => {
  // The layer may only change readings. If it ever changed a surface or a
  // range, annotateJapaneseLine would reject the whole line.
  const line = "磊々常世";
  const tokens = [token("磊々", 0, ""), token("常世", 2, "ツネヨ")];
  const got = applyJmdictReadings(tokens, readings);
  assertAnalyzerTokens(line, got);
  assert.equal(got[0]!.surface, "磊々");
  assert.equal(got[0]!.start, 0);
  assert.equal(got[1]!.end, 4);
});

test("a surface absent from the asset is left alone", () => {
  const got = applyJmdictReadings([token("千本桜", 0, "センボンザクラ")], readings);
  assert.equal(got[0]!.readingKana, "センボンザクラ");
});

test("a name-tagged token is never corrected, however wrong it looks", () => {
  // This was briefly a fix: Sudachi tags 常世 名詞,固有名詞,人名 inside
  // 三千世界 常世之闇 and reads it ツネヨ, where the wiki's furigana says とこよ.
  // Correcting name-tagged tokens fixed that and broke real names — 蓮 (レン)
  // became ハス and 千秋 (チアキ) became センシュウ, because a surface JMdict
  // carries can perfectly well also be a name. 常世 belongs to a per-song
  // reading override — the lyricist's own furigana, the way `hints.ts` already
  // takes 天（そら） — not to a per-word correction here.
  const named: AnalyzerToken = {
    ...token("常世", 0, "ツネヨ"),
    rawPos: ["名詞", "固有名詞", "人名", "名", "*", "*"],
  };
  const got = applyJmdictReadings([named], readings);
  assert.equal(got[0]!.readingKana, "ツネヨ");
});

test("an ordinary noun is never corrected either", () => {
  // The same lookup, one POS tag apart. 秋桜 is 名詞,普通名詞,一般 and JMdict
  // holds only あきざくら, so a rule keyed on disagreement alone would demote
  // コスモス — the reading the song means.
  const ordinary: AnalyzerToken = {
    ...token("秋桜", 0, "コスモス"),
    rawPos: ["名詞", "普通名詞", "一般", "*", "*", "*"],
  };
  const got = applyJmdictReadings([ordinary], readings);
  assert.equal(got[0]!.readingKana, "コスモス");
});

test("a real name keeps its name reading when JMdict does not carry the surface", () => {
  // 千本桜 itself is tagged 普通名詞 by Sudachi and is absent from the asset
  // (several readings), so neither path can touch it.
  const got = applyJmdictReadings([token("千本桜", 0, "センボンザクラ")], readings);
  assert.equal(got[0]!.readingKana, "センボンザクラ");
});
