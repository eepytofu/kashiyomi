import { strict as assert } from "node:assert";
import { test } from "node:test";
import { latinizeSegments, toLatinPunctuation } from "../src/engine/latinPunctuation.ts";

test("a fullwidth comma becomes a latin one with latin spacing", () => {
  // Captured from the running app: the pinyin row read "yuán ， sān" because
  // the segmenter spaced every token and the fullwidth mark kept its own
  // width. Latin orthography puts nothing before a comma and one space after.
  assert.equal(
    toLatinPunctuation("bái mǎ guò le lí yuán ， sān yuè de tiān"),
    "bái mǎ guò le lí yuán, sān yuè de tiān",
  );
});

test("sentence-final marks do not leave a trailing space", () => {
  assert.equal(toLatinPunctuation("tíng zhōng shù 。"), "tíng zhōng shù.");
  assert.equal(toLatinPunctuation("shén me ？"), "shén me?");
});

test("brackets attach inward on both sides", () => {
  assert.equal(toLatinPunctuation("hé （ hé shēng ）"), "hé (hé shēng)");
});

test("the enumeration comma and the japanese comma both romanize as a comma", () => {
  // 、 is dùnhào in Chinese and the ordinary comma in Japanese; Latin has one
  // mark for both.
  assert.equal(toLatinPunctuation("hǎi yī 、 xīng chén"), "hǎi yī, xīng chén");
  assert.equal(toLatinPunctuation("sora 、 umi"), "sora, umi");
});

test("runs of marks are not padded apart", () => {
  assert.equal(toLatinPunctuation("a ？ ！"), "a?!");
});

test("segments keep the same spacing as the joined line", () => {
  // The renderer draws the plain line from the joined string and the coloured
  // line from the segments, so the two must not disagree.
  const segments = [
    { text: "sanzensekai", origin: "inferred" },
    { text: " tokoyo", origin: "authored" },
    { text: "、", origin: "inferred" },
    { text: " yami", origin: "inferred" },
  ];
  const out = latinizeSegments(segments);
  assert.equal(out.map((s) => s.text).join(""), "sanzensekai tokoyo, yami");
  // Origins survive, since that is what the colouring reads.
  assert.deepEqual(out.map((s) => s.origin), ["inferred", "authored", "inferred", "inferred"]);
});

test("segments do not gain a leading or trailing space", () => {
  const out = latinizeSegments([{ text: " a" }, { text: "。" }]);
  assert.equal(out.map((s) => s.text).join(""), "a.");
});
