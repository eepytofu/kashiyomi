import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  HAN_CHAR,
  KANA_ONLY,
  hasHan,
  hasKana,
  kataToHira,
  usesKatakanaOkurigana,
} from "../src/engine/kana.ts";

test("katakana converts to hiragana", () => {
  assert.equal(kataToHira("テラサ"), "てらさ");
  assert.equal(kataToHira("ソラ"), "そら");
});

test("small ヵヶ convert too", () => {
  // The top of the katakana block. These appear in counters (三ヶ月) and in
  // names, and they sit right at the conversion range's upper bound.
  assert.equal(kataToHira("ヵヶ"), "ゕゖ");
});

test("the prolonged sound mark passes through unconverted", () => {
  // ー is outside the katakana block and is written the same in both kana, so
  // converting it would corrupt the reading.
  assert.equal(kataToHira("ラーメン"), "らーめん");
});

test("non-kana passes through kataToHira untouched", () => {
  assert.equal(kataToHira("桜 sakura 々"), "桜 sakura 々");
});

test("the prolonged sound mark and iteration marks count as kana", () => {
  // ー carries a line like ソラー, and dropping it from the kana class would
  // make such a line look kana-free and route to Chinese.
  assert.equal(hasKana("ー"), true);
  assert.equal(hasKana("ゝゞヽヾ"), true);
  assert.equal(KANA_ONLY.test("ソラー"), true);
});

test("the iteration mark and 〆ヵヶ count as han", () => {
  // 々 behaves as a kanji inside a word (磊々落々), and both the routing
  // ladder and furigana run-splitting depend on it classifying as han.
  assert.equal(hasHan("々"), true);
  assert.equal(hasHan("〆"), true);
  assert.equal(HAN_CHAR.test("ヶ"), true);
});

test("a wholly katakana-okurigana line is recognized", () => {
  // 夜ニ紛レ, 君ノ声モ届カナイヨ: stylized lyrics write inflection in
  // katakana, which the analyzer cannot parse until it is read as hiragana.
  assert.equal(usesKatakanaOkurigana("夜ニ紛レ"), true);
  assert.equal(usesKatakanaOkurigana("君ノ声モ届カナイヨ"), true);
});

test("a line that already uses hiragana is left alone", () => {
  // Its katakana is ordinary vocabulary, so converting the line would turn
  // ハイカラ into はいから.
  assert.equal(usesKatakanaOkurigana("大胆不敵に ハイカラ革命"), false);
});

test("katakana with no kanji is ordinary vocabulary, not okurigana", () => {
  assert.equal(usesKatakanaOkurigana("ハイカラ"), false);
  assert.equal(usesKatakanaOkurigana("アマツキツネ"), false);
});
