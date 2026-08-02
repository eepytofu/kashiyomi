// Assembles the per-line Japanese annotation: analyzer tokens + authored
// reading hints, producing furigana segments (with provenance) and a romaji
// line. Authored hints win over analyzer readings for both. Pure; no host
// imports.

import { alignFurigana } from "./furigana.ts";
import { kanaToRomaji, tokenRomaji } from "./romaji.ts";
import { KANA_ONLY, kataToHira } from "./kana.ts";
import type { ReadingHint } from "./hints.ts";
import { assertAnalyzerTokens, type AnalyzerToken } from "./tokens.ts";

export type LineFuriganaSegment = {
  /** Range in the display line (UTF-16 units). */
  readonly start: number;
  readonly end: number;
  readonly reading: string;
  /** Authored = provided in the lyric source (rendered distinctly). */
  readonly origin: "inferred" | "authored";
};

export type JapaneseLineAnnotation = {
  readonly furigana: readonly LineFuriganaSegment[];
  readonly romaji: string;
};

const NO_SPACE_BEFORE = /^[、。，．！？!?…・：;；:）)」』ー~〜]/u;
const NO_SPACE_AFTER = /[（(「『、。，．！？…・]$/u;

/**
 * Annotate one display line. `tokens` must be the analyzer output for exactly
 * this text (fail-closed if not). `hints` come from projectReadingHints on
 * the same text.
 */
export function annotateJapaneseLine(
  displayText: string,
  tokens: readonly AnalyzerToken[],
  hints: readonly ReadingHint[] = [],
): JapaneseLineAnnotation {
  assertAnalyzerTokens(displayText, tokens);

  const furigana: LineFuriganaSegment[] = [];
  const romajiParts: string[] = [];

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i]!;
    const hint = hints.find((h) => h.start < token.end && h.end > token.start);
    if (!hint) {
      for (const segment of alignFurigana(token.surface, token.readingKana)) {
        furigana.push({
          start: token.start + segment.start,
          end: token.start + segment.end,
          reading: segment.reading,
          origin: "inferred",
        });
      }
      appendRomaji(
        romajiParts,
        tokenRomaji(token.surface, token.readingKana, token.partOfSpeech),
        token.surface,
      );
      i += 1;
      continue;
    }

    // Group every consecutive token this hint overlaps and treat the run as
    // one authored unit, so a hint spanning multiple tokens is voiced once.
    let last = i;
    while (last + 1 < tokens.length && tokens[last + 1]!.start < hint.end) last += 1;
    const runStart = token.start;
    const runEnd = tokens[last]!.end;

    // The authored reading goes through the same okurigana anchoring as
    // inferred readings, so in 思ゆ(おぼゆ) the ruby おぼ lands on 思 only.
    const hintSurface = displayText.slice(hint.start, hint.end);
    const authored = alignFurigana(hintSurface, hint.reading);
    if (authored.length > 0) {
      for (const segment of authored) {
        furigana.push({
          start: hint.start + segment.start,
          end: hint.start + segment.end,
          reading: segment.reading,
          origin: "authored",
        });
      }
    } else {
      furigana.push({
        start: hint.start,
        end: hint.end,
        reading: kataToHira(hint.reading),
        origin: "authored",
      });
    }

    // Kana the token run carries outside the hinted word keeps its own sound.
    // If that context is not pure kana its sound cannot be reconstructed, so
    // the authored reading alone is voiced; it outranks the analyzer.
    const prefix = displayText.slice(runStart, Math.max(runStart, hint.start));
    const suffix = displayText.slice(Math.min(runEnd, hint.end), runEnd);
    const prefixOk = prefix === "" || KANA_ONLY.test(prefix);
    const suffixOk = suffix === "" || KANA_ONLY.test(suffix);
    const voiced = prefixOk && suffixOk
      ? kanaToRomaji(prefix + hint.reading + suffix)
      : kanaToRomaji(hint.reading);
    appendRomaji(romajiParts, voiced, displayText.slice(runStart, runEnd));
    i = last + 1;
  }

  furigana.sort((a, b) => a.start - b.start);
  return { furigana, romaji: romajiParts.join("") };
}

function appendRomaji(parts: string[], romaji: string, surface: string): void {
  if (romaji === "") return;
  const needsNoSpace =
    parts.length === 0 ||
    NO_SPACE_BEFORE.test(surface) ||
    NO_SPACE_AFTER.test(parts[parts.length - 1] ?? "");
  parts.push(needsNoSpace ? romaji : ` ${romaji}`);
}
