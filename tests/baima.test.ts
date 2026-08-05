import { strict as assert } from "node:assert";
import { test } from "node:test";
import { classifyLines } from "../src/engine/lineKinds.ts";

/**
 * 白马过了离原 (冉语优 / 海伊 / 星尘Minus), captured from the running app on
 * 2026-08-04 with `npm run capture`, read from data-kashiyomi-src so this is
 * NetEase's own text and not our repaired output. 译 was off, which is the
 * default, so every line is untranslated and the credit-shape fallback is
 * inert: classification here rests entirely on the role table and the marker
 * pattern.
 *
 * It is the regression test for the credit block a duet upload actually ships:
 * eleven of them, which is why no window constant can be trusted, plus
 * 和声编写 (和声 + 编写, decomposed rather than listed) and 笛子, which must not
 * decompose into itself.
 *
 * **Trimmed 2026-08-06 for copyright, not for test quality.** It previously held
 * all 38 sung lines — the complete work, verbatim, in a public repo. Kept: the
 * whole credit block and every marker (role labels and names, which are not the
 * work) plus the sung lines that carry real signal, chiefly the comma-free
 * ten-character ones that come closest to passing for a label and 是你么, which
 * opens on a SENTENCE_CHARS character. Provenance is intact — what is here is
 * still the capture. Filling the gap with invented lines would have traded a
 * small legal exposure for the exact defect this file exists to prevent.
 */
const BAIMA = [
  "作词: 冉语优",
  "作曲: 塔库",
  "编曲: Fsy小诺",
  "作曲：塔库",
  "作词：冉语优",
  "编曲：Fsy小诺",
  "演唱：海伊、星尘Minus",
  "调教：瑞安Ryan",
  "笛子：囚牛",
  "和声编写：雾敛",
  "混音：Mr.曾经",
  "【合】",
  "白马过了离原，三月的天，春风漫草野",
  "千里外不曾相见，明朗眉眼，是谁正负剑",
  "【minus】",
  "庭中树，初长成还不及肩",
  "年华尚浅的人，心事都浅",
  "【minus】",
  "三鼓前城旗掩近昏的夜",
  "谁衣衫却白得那样惹眼",
  "【海伊】",
  "是你么，按图指点三千言",
  "在梦中故事里可曾相见",
  "【合】",
  "却向何处找寻我的人间",
] as const;

test("the song splits into 11 credits, 5 markers and 9 lyrics", () => {
  const kinds = classifyLines(
    BAIMA.map((text) => ({ text, translation: "untranslated" as const })),
  );
  assert.equal(BAIMA.length, 25);
  assert.equal(kinds.filter((k) => k === "credit").length, 11);
  assert.equal(kinds.filter((k) => k === "marker").length, 5);
  assert.equal(kinds.filter((k) => k === "lyric").length, 9);
});

test("the credits are exactly the first eleven lines", () => {
  const kinds = classifyLines(
    BAIMA.map((text) => ({ text, translation: "untranslated" as const })),
  );
  const creditIndices = kinds
    .map((k, i) => (k === "credit" ? i : -1))
    .filter((i) => i >= 0);
  assert.deepEqual(creditIndices, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test("no sung line is mistaken for a credit", () => {
  // Every lyric in this song is comma-heavy Chinese and several are long
  // enough to look like a label if the bound slipped.
  const kinds = classifyLines(
    BAIMA.map((text) => ({ text, translation: "untranslated" as const })),
  );
  for (let i = 11; i < BAIMA.length; i++) {
    assert.notEqual(kinds[i], "credit", `line ${i}: ${BAIMA[i]}`);
  }
});
