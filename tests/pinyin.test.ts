import { strict as assert } from "node:assert";
import { test } from "node:test";
import CompleteDict from "@pinyin-pro/data/complete";
import { registerCompleteDict, romanizeMandarin } from "../src/engine/pinyin.ts";

registerCompleteDict(CompleteDict);

test("tone marks by default", () => {
  assert.equal(romanizeMandarin("狂想", { tones: true, joinWords: false }), "kuáng xiǎng");
});

test("complete dictionary picks lexical readings", () => {
  assert.equal(romanizeMandarin("诗行", { tones: true, joinWords: false }), "shī háng");
});

test("word joining keeps segmented words together", () => {
  assert.equal(
    romanizeMandarin("我在每夜狂想", { tones: true, joinWords: true }),
    "wǒ zài měiyè kuángxiǎng",
  );
});

test("no tones", () => {
  assert.equal(romanizeMandarin("狂想", { tones: false, joinWords: false }), "kuang xiang");
});

test("latin runs pass through", () => {
  assert.equal(
    romanizeMandarin("说不出的sorry", { tones: false, joinWords: false }),
    "shuo bu chu de sorry",
  );
  assert.equal(romanizeMandarin("mp3", { tones: true, joinWords: false }), "mp3");
});

test("empty input", () => {
  assert.equal(romanizeMandarin("  ", { tones: true, joinWords: false }), "");
  // The empty string specifically: pinyin-pro throws on it ("Cannot read
  // properties of undefined (reading 'patterns')") while whitespace comes back
  // as "". The guard in romanizeMandarin is what stops that, so it is
  // load-bearing rather than an optimization, and a fixture of "  " alone
  // could not tell the difference.
  assert.equal(romanizeMandarin("", { tones: true, joinWords: false }), "");
});

test("a pinyin row uses latin punctuation", () => {
  // The whole first sung line of 白马过了离原, captured from the app on
  // 2026-08-04. Romanization is Latin-script orthography, so it takes Latin
  // marks; leaving the fullwidth comma in also left the segmenter's spaces on
  // both sides ("lí yuán ， sān").
  assert.equal(
    romanizeMandarin("白马过了离原，三月的天，春风漫草野", { tones: true, joinWords: false }),
    "bái mǎ guò le lí yuán, sān yuè de tiān, chūn fēng màn cǎo yě",
  );
});
