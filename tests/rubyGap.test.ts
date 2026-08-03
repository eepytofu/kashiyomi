import { strict as assert } from "node:assert";
import { test } from "node:test";
import { rubyWordSpacingEm } from "../src/engine/rubyGap.ts";
import type { LineFuriganaSegment } from "../src/engine/japanese.ts";

function segment(start: number, end: number, reading: string): LineFuriganaSegment {
  return { start, end, reading, origin: "inferred" };
}

test("a reading no wider than its base needs no compensation", () => {
  // 夜/よる: 2 kana at 50% is 1em over a 1em base.
  assert.equal(rubyWordSpacingEm([segment(0, 1, "よる")], 0.5), 0);
  // 此処/ここ: same width as its base at any size below 100%.
  assert.equal(rubyWordSpacingEm([segment(0, 2, "ここ")], 0.75), 0);
});

test("no furigana segments means no compensation", () => {
  assert.equal(rubyWordSpacingEm([], 0.75), 0);
});

test("千本桜 at 75% opens gaps that a space must beat", () => {
  // せんぼんざくら is 7 kana at 0.75 = 5.25em over a 3em base. The reading
  // overhangs by half a character, leaving 1.875em of stretch distributed
  // around the three base characters.
  const gap = rubyWordSpacingEm([segment(0, 3, "せんぼんざくら")], 0.75);
  assert.ok(Math.abs(gap - 0.625) < 1e-9, `expected ~0.625, got ${gap}`);
});

test("the same word at 50% needs far less", () => {
  const gap = rubyWordSpacingEm([segment(0, 3, "せんぼんざくら")], 0.5);
  assert.ok(Math.abs(gap - 0.0833333) < 1e-4, `expected ~0.0833, got ${gap}`);
});

test("predicted stretch matches what NCM actually laid out", () => {
  // Measured via the layout dump at 22px base / 75% readings. Each entry is
  // [base chars, reading chars, measured stretch in px]. Guards the overhang
  // constant: without it every prediction runs ~8px wide.
  const measured: readonly (readonly [number, number, number])[] = [
    [3, 7, 40.4], // 千本桜 / せんぼんざくら
    [3, 7, 41.2], // 環状線 / かんじょうせん
    [3, 7, 40.7], // 禅定門 / ぜんじょうもん
    [4, 9, 52.9], // 花魁道中 / おいらんどうちゅう
  ];
  const fontPx = 22;
  for (const [baseChars, readingChars, measuredPx] of measured) {
    const gapEm = rubyWordSpacingEm(
      [segment(0, baseChars, "ぁ".repeat(readingChars))],
      0.75,
    );
    const predictedPx = gapEm * baseChars * fontPx;
    assert.ok(
      Math.abs(predictedPx - measuredPx) < 1.5,
      `${baseChars} chars under ${readingChars}: predicted ${predictedPx.toFixed(1)}px, measured ${measuredPx}px`,
    );
  }
});

test("compensation scales with reading size", () => {
  const small = rubyWordSpacingEm([segment(0, 3, "せんぼんざくら")], 0.5);
  const large = rubyWordSpacingEm([segment(0, 3, "せんぼんざくら")], 0.75);
  assert.ok(large > small, "a larger reading must widen the boundary further");
});

test("a single-character base spreads only half its stretch to each side", () => {
  // 鋼/はがね at 75%: 2.25em of reading, less the overhang, over a 1em base.
  // There is no interior to distribute across, so it shows as padding either
  // side of 鋼 — which is why 鋼 sits apart from の in 鋼の檻.
  const gap = rubyWordSpacingEm([segment(0, 1, "はがね")], 0.75);
  assert.ok(Math.abs(gap - 0.4375) < 1e-9, `expected ~0.4375, got ${gap}`);
});

test("the widest segment on the line decides the boundary", () => {
  // On 千本桜 夜ニ紛レ, 千本桜 outweighs 夜/よる and 紛/まぎ.
  const gap = rubyWordSpacingEm(
    [segment(0, 3, "せんぼんざくら"), segment(4, 5, "よる"), segment(6, 7, "まぎ")],
    0.75,
  );
  assert.ok(Math.abs(gap - 0.625) < 1e-9, `expected ~0.625, got ${gap}`);
});

test("a pathological segment is capped", () => {
  // One kanji under a six-kana reading at full size would otherwise turn a
  // space into a chasm.
  assert.equal(rubyWordSpacingEm([segment(0, 1, "こここここここ")], 1), 1.5);
});

test("a non-positive reading scale is ignored", () => {
  assert.equal(rubyWordSpacingEm([segment(0, 3, "せんぼんざくら")], 0), 0);
});

test("surrogate pairs count as one character", () => {
  // Counting UTF-16 units would double-count and overstate the stretch.
  const gap = rubyWordSpacingEm([segment(0, 2, "\u{20B9F}\u{20B9F}")], 0.5);
  assert.equal(gap, 0);
});
