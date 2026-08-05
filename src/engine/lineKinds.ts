// What each line of a lyric file *is*, before anything is read or routed:
// a lyric, a production credit, or a singer marker.
//
// Pure, and deliberately so. This runs over a whole song at once because two
// of the three signals are document-level — where a line sits, and whether the
// player translated it while translating its neighbours — so it cannot be
// decided one line at a time the way `isCreditLine` can.

import type { LineTranslationState } from "./cjk.ts";
import { hasCreditShape, isCreditLine, isPartMarkerLine } from "./metadata.ts";

export type LineKind = "lyric" | "credit" | "marker";

export type ClassifiableLine = {
  text: string;
  translation: LineTranslationState;
};

/**
 * How far into the song the credit-shape fallback is allowed to look.
 * Credits sit at the top of every lyric file NetEase serves (lines 1-3 in
 * all three songs captured so far); further down, a colon is just a colon.
 */
export const CREDIT_SCAN_LINES = 6;

/**
 * Classify every line of a song. Indices line up with the input.
 *
 * Credits (作词: …, 编曲：…) are not lyrics: annotating them adds noise and
 * translating them wastes a request. The role table cannot list every role, so
 * a line merely *shaped* like a credit also counts when both of the other
 * signals agree — it sits in the song's opening lines, and the player left it
 * untranslated while translating the song around it. That is what an unlisted
 * role looks like, and a real lyric in those first lines would have been
 * translated.
 *
 * Singer markers (【合】, 【海伊】) name who sings the next block. They outrank
 * the credit test because they are never annotated either way; there is
 * nothing in them to read.
 */
export function classifyLines(lines: readonly ClassifiableLine[]): LineKind[] {
  // The shape fallback leans on a line going untranslated, which only means
  // something once the whole song is known to carry translations at all.
  const songHasTranslations = lines.some((line) => line.translation === "translated");
  const inCreditRun = creditRunMembership(lines);

  return lines.map((line, index) => {
    if (isPartMarkerLine(line.text)) return "marker";
    if (isCreditLine(line.text)) return "credit";
    if (inCreditRun[index] && hasCreditShape(line.text)) return "credit";
    if (
      index < CREDIT_SCAN_LINES &&
      songHasTranslations &&
      line.translation === "untranslated" &&
      hasCreditShape(line.text)
    ) {
      return "credit";
    }
    return "lyric";
  });
}

/**
 * Which lines sit inside a credit block, found by growing outward from every
 * credit the role table confirms rather than by looking at a fixed region.
 *
 * This is the only signal that works on a Chinese song. The translation-gated
 * rule above needs the player to have translated the song, and **NCM never
 * translates Chinese into Chinese** — that is rung 3 of the `cjk.ts` ladder — so
 * `songHasTranslations` is structurally false for every Chinese track and no
 * setting can change it. Every reported miss has been on one: 女声 and 录音室 on
 * 太成都, 编曲/和声编写 on 洛阳怀.
 *
 * It grows in **both** directions because credits are not only at the top. A
 * 65-line 国风堂 track captured 2026-08-06 carries four at the head and eleven at
 * the foot, and the foot block is where the role table failed hardest: 分轨,
 * 企划题字, 插画, 设计 and a 注： note were all annotated and queued for
 * translation. Expanding from the anchors 混音/和声/监制/出品 recovers all five
 * with no new table entries.
 *
 * Anchoring on a confirmed credit and not on a marker is deliberate: 【合】
 * recurs throughout a song to say who sings next, so anchoring there would open
 * a block in the middle of the lyrics. A marker still *continues* a run, so a
 * block with one buried in it stays whole.
 *
 * Two things keep it from eating a song:
 *
 *   - a run stops at the first line that is not credit-shaped, and
 *     `hasCreditShape` already refuses kana and sentence characters, so a real
 *     lyric like 答案是：我不知道 ends it on 是/我/不. On the capture above the
 *     head block stops dead at /题记/ and the foot block at 惟愿戴荣光与你归家;
 *   - shape alone cannot open a block. Without a confirmed credit to anchor it,
 *     a song whose lines merely look like credits is left entirely alone.
 *
 * This also retires the arbitrary part of `CREDIT_SCAN_LINES`. Six was already
 * wrong — 白马过了离原 opens with eleven credits and a marker — and widening it
 * to twelve only waits for a song with thirteen.
 */
function creditRunMembership(lines: readonly ClassifiableLine[]): boolean[] {
  const continues = lines.map(
    (line) =>
      isCreditLine(line.text) || isPartMarkerLine(line.text) || hasCreditShape(line.text),
  );
  const inRun: boolean[] = new Array(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (!isCreditLine(lines[i]!.text)) continue;
    for (let j = i; j >= 0 && continues[j]; j--) inRun[j] = true;
    for (let j = i; j < lines.length && continues[j]; j++) inRun[j] = true;
  }
  return inRun;
}
