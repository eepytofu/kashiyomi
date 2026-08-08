// What each line of a lyric file *is*, before anything is read or routed:
// a lyric, a production credit, or a singer marker.

import type { LineTranslationState } from "./cjk.ts";
import {
  hasCreditShape,
  isCopyrightNotice,
  isCreditLine,
  isPartMarkerLine,
} from "./metadata.ts";

export type LineKind = "lyric" | "credit" | "marker" | "notice";

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

/** Classify every line of a song. Indices line up with the input. */
export function classifyLines(lines: readonly ClassifiableLine[]): LineKind[] {
  // The shape fallback leans on a line going untranslated, which only means
  // something once the whole song is known to carry translations at all.
  const songHasTranslations = lines.some((line) => line.translation === "translated");
  const inCreditRun = creditRunMembership(lines);

  return lines.map((line, index) => {
    if (isPartMarkerLine(line.text)) return "marker";
    // Its own kind rather than a credit, because a credit is annotated when the
    if (isCopyrightNotice(line.text)) return "notice";
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
