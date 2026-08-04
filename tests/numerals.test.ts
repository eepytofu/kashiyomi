import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  isNumeral,
  readCountedPhrase,
  readKanjiNumeral,
  readKnownPhrase,
} from "../src/engine/numerals.ts";

test("kanji numerals read by rule", () => {
  assert.equal(readKanjiNumeral("三"), "さん");
  assert.equal(readKanjiNumeral("十"), "じゅう");
  assert.equal(readKanjiNumeral("二十一"), "にじゅういち");
  assert.equal(readKanjiNumeral("三万"), "さんまん");
});

test("powers assimilate against the digit in front", () => {
  // These are the cases a plain digit-by-digit reader gets wrong.
  assert.equal(readKanjiNumeral("六百"), "ろっぴゃく");
  assert.equal(readKanjiNumeral("八百"), "はっぴゃく");
  assert.equal(readKanjiNumeral("三百"), "さんびゃく");
  assert.equal(readKanjiNumeral("三千"), "さんぜん");
  assert.equal(readKanjiNumeral("八千"), "はっせん");
});

test("counters assimilate against the digit in front", () => {
  assert.equal(readCountedPhrase("一", "本", "ほん"), "いっぽん");
  assert.equal(readCountedPhrase("三", "本", "ほん"), "さんぼん");
  assert.equal(readCountedPhrase("一", "匹", "ひき"), "いっぴき");
  assert.equal(readCountedPhrase("三", "匹", "ひき"), "さんびき");
  assert.equal(readCountedPhrase("六", "匹", "ひき"), "ろっぴき");
});

test("assimilation is driven by the last digit, not the whole number", () => {
  // 21匹 is にじゅういっぴき: the rule fires on 一 while 二十 reads normally in
  // front of it. Keying the lookup on the whole numeral missed this.
  assert.equal(readCountedPhrase("二十一", "匹", "ひき"), "にじゅういっぴき");
  assert.equal(readCountedPhrase("21", "匹", "ひき"), "にじゅういっぴき");
});

test("irregular counted phrases come from the table", () => {
  // No rule produces these; calendar days are the worst offenders.
  assert.equal(readCountedPhrase("一", "日", "にち"), "ついたち");
  assert.equal(readCountedPhrase("七", "日", "にち"), "なのか");
  assert.equal(readCountedPhrase("二十", "日", "にち"), "はつか");
  assert.equal(readCountedPhrase("十四", "日", "にち"), "じゅうよっか");
  assert.equal(readCountedPhrase("一", "人", "にん"), "ひとり");
  assert.equal(readCountedPhrase("二", "人", "にん"), "ふたり");
  assert.equal(readKnownPhrase("二十歳"), "はたち");
});

test("arabic digits read the same way, halfwidth and fullwidth", () => {
  // Lyrics write both. 21グラム is a real line captured from the app, where the
  // analyzer abstained and the romaji row showed the bare digits.
  assert.equal(readKanjiNumeral("21"), "にじゅういち");
  assert.equal(readKanjiNumeral("７"), "なな");
  assert.equal(readCountedPhrase("3", "匹", "ひき"), "さんびき");
  assert.equal(readCountedPhrase("６", "本", "ほん"), "ろっぽん");
  assert.equal(readCountedPhrase("1", "日", "にち"), "ついたち");
});

test("abstains rather than guessing", () => {
  // Fail closed: a caller that gets "" keeps the analyzer's own answer.
  assert.equal(readKanjiNumeral("あ"), "");
  assert.equal(readKanjiNumeral("2026年代物"), "");
  // A leading zero means an identifier, not a count: 007 is not なな. Asserting
  // only isNumeral("0") did not discriminate, because a lone 0 reads as "" either
  // way — the mutation `numerals/leading-zero-accepted` survived until this case.
  assert.equal(isNumeral("0"), false, "a leading zero is an id, not a count");
  assert.equal(isNumeral("007"), false, "an id, not the number seven");
  assert.equal(readKanjiNumeral("007"), "");
  assert.equal(isNumeral("01"), false);
  assert.equal(isNumeral("12345"), false, "beyond the rules this module covers");
  assert.equal(isNumeral(""), false);
  // Unknown counter with no euphony entry and no reading from the analyzer.
  assert.equal(readCountedPhrase("三", "騎", ""), "");
});

test("a numeral the analyzer can already read is left alone", () => {
  // 二十歳 → ハタチ comes from SudachiDict; this module only fills abstentions,
  // which is enforced at the call site in japanese.ts.
  assert.equal(readKnownPhrase("二十歳"), "はたち");
  assert.equal(readKnownPhrase("普通"), "");
});
