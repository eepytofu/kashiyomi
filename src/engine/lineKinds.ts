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

  return lines.map((line, index) => {
    if (isPartMarkerLine(line.text)) return "marker";
    if (isCreditLine(line.text)) return "credit";
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
