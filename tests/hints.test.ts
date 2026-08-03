import { strict as assert } from "node:assert";
import { test } from "node:test";
import { maskHintBrackets, projectReadingHints } from "../src/engine/hints.ts";

test("accepts an inline reading hint and hides the parenthetical", () => {
  const { displayText, hints } = projectReadingHints("天(そら)へ翔けてゆけ");
  assert.equal(displayText, "天へ翔けてゆけ");
  assert.deepEqual(hints, [{ start: 0, end: 1, reading: "そら" }]);
});

test("accepts fullwidth parentheses", () => {
  const { displayText, hints } = projectReadingHints("永久（とわ）に輝く");
  assert.equal(displayText, "永久に輝く");
  assert.deepEqual(hints, [{ start: 0, end: 2, reading: "とわ" }]);
});

test("accepts a line-final hint when real context precedes it", () => {
  const { displayText, hints } = projectReadingHints("消えない灯(あかり)");
  assert.equal(displayText, "消えない灯");
  assert.deepEqual(hints, [{ start: 4, end: 5, reading: "あかり" }]);
});

test("multiple hints in one line", () => {
  const { displayText, hints } = projectReadingHints("天(そら)と地(つち)の間");
  assert.equal(displayText, "天と地の間");
  assert.deepEqual(hints, [
    { start: 0, end: 1, reading: "そら" },
    { start: 2, end: 3, reading: "つち" },
  ]);
});

test("accepts a kanji plus okurigana hint", () => {
  const { displayText, hints } = projectReadingHints("嘘 思ゆ(おぼゆ)桜の蜜に");
  assert.equal(displayText, "嘘 思ゆ桜の蜜に");
  assert.deepEqual(hints, [{ start: 2, end: 4, reading: "おぼゆ" }]);
});

test("rejects when the reading does not end with the okurigana", () => {
  const line = "歌う(こえ)を聞け";
  const { displayText, hints } = projectReadingHints(line);
  assert.equal(displayText, line);
  assert.deepEqual(hints, []);
});

test("rejects a standalone chant echo", () => {
  const line = "勝負服(はっはっ)";
  const { displayText, hints } = projectReadingHints(line);
  assert.equal(displayText, line);
  assert.deepEqual(hints, []);
});

test("rejects when whitespace precedes the paren", () => {
  const line = "天 (そら)へ";
  const { displayText, hints } = projectReadingHints(line);
  assert.equal(displayText, line);
  assert.deepEqual(hints, []);
});

test("accepts a katakana reading over hiragana okurigana", () => {
  // Authored hints are sometimes written in katakana. The okurigana match has
  // to normalize both sides or ゆ against ユ looks like a mismatch and the
  // whole hint is thrown away.
  const { displayText, hints } = projectReadingHints("嘘 思ゆ(オボユ)桜");
  assert.equal(displayText, "嘘 思ゆ桜");
  assert.deepEqual(hints, [{ start: 2, end: 4, reading: "オボユ" }]);
});

test("a single-kanji word at the end of a kana line is still a reading", () => {
  // The chant-echo rejection needs the annotated word to be at least two
  // characters. A lone kanji after kana is an ordinary short reading, not
  // backing vocals.
  const { displayText, hints } = projectReadingHints("らら 灯(あかり)");
  assert.equal(displayText, "らら 灯");
  assert.deepEqual(hints, [{ start: 3, end: 4, reading: "あかり" }]);
});

test("real context before the word defeats the chant rejection", () => {
  // 勝負服(はっはっ) alone is a chant echo; the same word after kanji is a
  // genuine reading, so the rule must look at what precedes it.
  const { displayText, hints } = projectReadingHints("僕の勝負服(はっはっ)");
  assert.equal(displayText, "僕の勝負服");
  assert.deepEqual(hints, [{ start: 2, end: 5, reading: "はっはっ" }]);
});

test("rejects non-kana parentheticals", () => {
  const line = "天(Stage)へ";
  const { displayText, hints } = projectReadingHints(line);
  assert.equal(displayText, line);
  assert.deepEqual(hints, []);
});

test("the parenthetical is removed even when its reading is not used", () => {
  // Whether to *use* 天（そら） is a setting; whether to render the markup is
  // not. SudachiDict contains 天（そら） as an entry reading テン, so leaving it
  // in gave one five-character token and a てん ruby smeared across the
  // brackets, with そら missing from the romaji. Captured from アマツキツネ.
  const { displayText, hints } = projectReadingHints("今宵も天（そら）は　明るく");
  assert.equal(displayText, "今宵も天は　明るく");
  assert.deepEqual(hints, [{ start: 3, end: 4, reading: "そら" }]);
});

test("masking blanks only the brackets and keeps the length", () => {
  // With the setting off the lyric stays exactly as NetEase serves it, so the
  // annotation is still on screen. The analyzer still must not see the
  // brackets: SudachiDict has 天（そら） as one entry reading テン, which put a
  // てん ruby across all five characters. Length is preserved because every
  // furigana offset indexes the displayed line.
  const line = "今宵も天（そら）は　明るく";
  const masked = maskHintBrackets(line);
  assert.equal(masked, "今宵も天 そら は　明るく");
  assert.equal(masked.length, line.length);
});

test("masking leaves a rejected annotation alone", () => {
  // 勝負服(はっはっ) is a chant echo, not a reading, so it is not a hint and
  // its brackets stay.
  const line = "勝負服(はっはっ)";
  assert.equal(maskHintBrackets(line), line);
});

test("masking handles several hints in one line", () => {
  const line = "天(そら)と地(つち)";
  assert.equal(maskHintBrackets(line), "天 そら と地 つち ");
  assert.equal(maskHintBrackets(line).length, line.length);
});
