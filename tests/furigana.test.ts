import { strict as assert } from "node:assert";
import { test } from "node:test";
import { alignFurigana } from "../src/engine/furigana.ts";

test("okurigana anchoring puts ruby only over kanji", () => {
  assert.deepEqual(alignFurigana("照らさ", "テラサ"), [
    { start: 0, end: 1, reading: "て" },
  ]);
  assert.deepEqual(alignFurigana("食べる", "タベル"), [
    { start: 0, end: 1, reading: "た" },
  ]);
});

test("leading kana anchors", () => {
  assert.deepEqual(alignFurigana("お願い", "オネガイ"), [
    { start: 1, end: 2, reading: "ねが" },
  ]);
});

test("interleaved kana splits multiple kanji runs", () => {
  assert.deepEqual(alignFurigana("離れ離れ", "ハナレバナレ"), [
    { start: 0, end: 1, reading: "はな" },
    { start: 2, end: 3, reading: "ばな" },
  ]);
  assert.deepEqual(alignFurigana("夢見て", "ユメミテ"), [
    { start: 0, end: 2, reading: "ゆめみ" },
  ]);
});

test("pure kanji compounds get whole-word ruby", () => {
  assert.deepEqual(alignFurigana("灯篭", "トウロウ"), [
    { start: 0, end: 2, reading: "とうろう" },
  ]);
  assert.deepEqual(alignFurigana("東京", "トウキョウ"), [
    { start: 0, end: 2, reading: "とうきょう" },
  ]);
});

test("kana-only tokens need no ruby", () => {
  assert.deepEqual(alignFurigana("ゆく", "ユク"), []);
  assert.deepEqual(alignFurigana("の", "ノ"), []);
});

test("unusable readings abstain", () => {
  assert.deepEqual(alignFurigana("灯", ""), []);
  assert.deepEqual(alignFurigana("Fake", "フェイク"), []);
});

test("katakana okurigana anchors against a katakana reading", () => {
  // 夜ニ紛レ style lines reach the aligner with katakana okurigana. The anchor
  // has to be normalized like the reading is, or レ never matches れ and the
  // split is abandoned.
  assert.deepEqual(alignFurigana("紛レ", "マギレ"), [
    { start: 0, end: 1, reading: "まぎ" },
  ]);
});

test("a non-kana reading is rejected rather than rendered", () => {
  // Romaji or latin coming back from the analyzer is not a reading; putting
  // it in a ruby would print it over the kanji.
  assert.deepEqual(alignFurigana("灯篭", "tourou"), []);
  assert.deepEqual(alignFurigana("灯篭", "トウロウ2"), []);
});

test("mismatched anchors fall back to whole-surface ruby", () => {
  // Reading does not contain the kana anchor れ where expected.
  assert.deepEqual(alignFurigana("離れ離れ", "ハナレバナ"), [
    { start: 0, end: 4, reading: "はなればな" },
  ]);
});

test("iteration mark stays inside the kanji run", () => {
  assert.deepEqual(alignFurigana("日々", "ヒビ"), [
    { start: 0, end: 2, reading: "ひび" },
  ]);
});
