import { strict as assert } from "node:assert";
import { test } from "node:test";
import { classifyLines, CREDIT_SCAN_LINES, type ClassifiableLine } from "../src/engine/lineKinds.ts";

/** Shorthand for a song NCM is showing no 译 rows for. */
function untranslated(...texts: string[]): ClassifiableLine[] {
  return texts.map((text) => ({ text, translation: "untranslated" as const }));
}

test("a credit header is separated from the lyrics under it", () => {
  // 白马过了离原, captured 2026-08-03: the opening credits, the singer marker
  // that follows them, and the first sung line.
  const kinds = classifyLines(
    untranslated("作词：某人", "和声编写：雾敛", "笛子：囚牛", "【合】", "白马过了离原"),
  );
  assert.deepEqual(kinds, ["credit", "credit", "credit", "marker", "lyric"]);
});

test("a marker outranks the credit tests", () => {
  // Markers are skipped whatever the credits setting says, so they must never
  // come back as "credit" — the caller annotates credits on request but never
  // annotates markers.
  assert.deepEqual(classifyLines(untranslated("【合】", "[Chorus]", "（合）")), [
    "marker",
    "marker",
    "marker",
  ]);
});

test("a parenthesized lyric line stays a lyric", () => {
  // 白马过了离原 writes a whole sung line in brackets. Length is what separates
  // it from a singer's name.
  assert.deepEqual(classifyLines(untranslated("（白马过了离原，三月的天，春风漫草野）")), [
    "lyric",
  ]);
});

test("the shape fallback needs all three signals", () => {
  // PV: is a real credit the role table does not list. On its own the shape is
  // not enough — it is only a credit when the song is being translated and
  // this line was passed over.
  const song: ClassifiableLine[] = [
    { text: "PV：某人", translation: "untranslated" },
    { text: "白马过了离原", translation: "translated" },
  ];
  assert.deepEqual(classifyLines(song), ["credit", "lyric"]);
});

test("the shape fallback is inert when the song carries no translations", () => {
  // With 译 off every line reads as untranslated, so "untranslated" carries no
  // information and the fallback has to switch itself off. Otherwise any
  // colon-bearing opening line would be dropped from a song nobody translated.
  assert.deepEqual(classifyLines(untranslated("PV：某人", "白马过了离原")), ["lyric", "lyric"]);
});

test("the shape fallback reaches six lines in and no further", () => {
  // Synthetic: a colon-bearing line walked down the song one position at a
  // time. Deep in a lyric a colon is just a colon, so the bound is what stops
  // a real line being dropped.
  //
  // The expected positions are written as literals on purpose. Deriving them
  // from CREDIT_SCAN_LINES makes the test move with the constant, so widening
  // the bound to any value would still pass — checked with the mutation
  // `lineKinds/scan-bound-unbounded`, which survived until this was literal.
  assert.equal(CREDIT_SCAN_LINES, 6);
  for (let position = 0; position < 8; position++) {
    const lines: ClassifiableLine[] = [];
    for (let i = 0; i < 8; i++) {
      lines.push(
        i === position
          ? { text: "PV：某人", translation: "untranslated" }
          : { text: "白马过了离原", translation: "translated" },
      );
    }
    assert.equal(
      classifyLines(lines)[position],
      position <= 5 ? "credit" : "lyric",
      `position ${position}`,
    );
  }
});

test("a listed role is a credit wherever it sits and however 译 is set", () => {
  // The table path is independent of position and translation state: it is the
  // only path that works with 译 off, which is the default.
  const lines: ClassifiableLine[] = [];
  for (let i = 0; i < CREDIT_SCAN_LINES + 3; i++) {
    lines.push({ text: "白马过了离原", translation: "untranslated" });
  }
  lines.push({ text: "笛子：囚牛", translation: "untranslated" });
  const kinds = classifyLines(lines);
  assert.equal(kinds[kinds.length - 1], "credit");
});

test("a translated opening line is a lyric even when it is credit-shaped", () => {
  // The player translating it is what says it is not a credit — NetEase never
  // translates the credit block.
  const song: ClassifiableLine[] = [
    { text: "PV：某人", translation: "translated" },
    { text: "白马过了离原", translation: "translated" },
  ];
  assert.deepEqual(classifyLines(song), ["lyric", "lyric"]);
});

test("indices line up with the input", () => {
  const song = untranslated("作词：某人", "白马过了离原", "【海伊】", "三月的天");
  const kinds = classifyLines(song);
  assert.equal(kinds.length, song.length);
  assert.deepEqual(kinds, ["credit", "lyric", "marker", "lyric"]);
});

test("an empty song classifies to nothing", () => {
  assert.deepEqual(classifyLines([]), []);
});
