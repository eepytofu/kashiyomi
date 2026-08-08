// Aligns a token's kana reading onto its surface so ruby lands only over the

import { HAN_CHAR, KANA_ONLY, kataToHira } from "./kana.ts";

export type FuriganaSegment = {
  /** Range in the token surface (UTF-16 units, token-relative). */
  readonly start: number;
  readonly end: number;
  readonly reading: string;
};

type SurfaceRun = {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly isHan: boolean;
};

function splitRuns(surface: string): SurfaceRun[] {
  const runs: SurfaceRun[] = [];
  let index = 0;
  for (const ch of surface) {
    const isHan = HAN_CHAR.test(ch);
    const width = ch.length; // UTF-16 units of this code point
    const last = runs[runs.length - 1];
    if (last && last.isHan === isHan) {
      runs[runs.length - 1] = { ...last, text: last.text + ch, end: last.end + width };
    } else {
      runs.push({ text: ch, start: index, end: index + width, isHan });
    }
    index += width;
  }
  return runs;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchRuns(
  runs: readonly SurfaceRun[],
  reading: string,
  lazy: boolean,
): string[] | undefined {
  const quant = lazy ? "(.+?)" : "(.+)";
  let pattern = "^";
  for (const run of runs) {
    pattern += run.isHan ? quant : escapeRegex(kataToHira(run.text));
  }
  pattern += "$";
  const match = reading.match(new RegExp(pattern, "u"));
  return match ? match.slice(1) : undefined;
}

/** Compute furigana segments for one analyzed token. */
export function alignFurigana(surface: string, readingKana: string): FuriganaSegment[] {
  if (surface === "" || readingKana === "" || !KANA_ONLY.test(readingKana)) return [];
  const reading = kataToHira(readingKana);
  const runs = splitRuns(surface);
  const hanRuns = runs.filter((run) => run.isHan);
  if (hanRuns.length === 0) return [];

  const surfaceEnd = runs[runs.length - 1]!.end;
  const wholeSurface: FuriganaSegment[] = [{ start: 0, end: surfaceEnd, reading }];

  if (hanRuns.length === runs.length && hanRuns.length === 1) {
    // Pure kanji token: single ruby over the whole word (per-kanji splitting
    // inside a compound is deliberately not attempted).
    return wholeSurface;
  }

  const lazy = matchRuns(runs, reading, true);
  if (!lazy) {
    // Kana anchors don't appear in the reading (rendaku edge cases, unusual
    // orthography): abstain from splitting.
    return wholeSurface;
  }
  const greedy = matchRuns(runs, reading, false);
  if (!greedy || lazy.join("\u0000") !== greedy.join("\u0000")) {
    return wholeSurface;
  }

  const segments: FuriganaSegment[] = [];
  let capture = 0;
  for (const run of runs) {
    if (!run.isHan) continue;
    const runReading = lazy[capture]!;
    capture += 1;
    segments.push({ start: run.start, end: run.end, reading: runReading });
  }
  return segments;
}
