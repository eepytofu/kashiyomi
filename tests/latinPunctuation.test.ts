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

test("the ideographic space becomes an ordinary one", () => {
  // U+3000 is a Han-typography glyph one em wide. Lyrics use it to break a
  // line into phrases, and left alone it renders as a gulf in the middle of a
  // romaji row. アマツキツネ writes 今宵も天（そら）は　明るく with one.
  assert.equal(toLatinPunctuation("koyoi mo ten wa 　 akaruku"), "koyoi mo ten wa akaruku");
  assert.equal(toLatinPunctuation("sanzensekai　tsuneyo no yami"), "sanzensekai tsuneyo no yami");
});

test("a middle dot separating names becomes a space", () => {
  // 编曲: ビートまりお / Masayoshi Minoshima is served with ・ between names in
  // some uploads; Latin does the same job with a space.
  assert.equal(toLatinPunctuation("beat mario・masayoshi"), "beat mario masayoshi");
  assert.equal(toLatinPunctuation("hǎi yī·xīng chén"), "hǎi yī xīng chén");
});

test("a mark with no space after it gains one", () => {
  // The other fixtures all arrive pre-spaced by the segmenter, so this is the
  // only case that exercises the inserting half of the spacing rule.
  assert.equal(toLatinPunctuation("wǒ，nǐ"), "wǒ, nǐ");
  assert.equal(toLatinPunctuation("a。b"), "a. b");
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
