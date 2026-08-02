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
});
