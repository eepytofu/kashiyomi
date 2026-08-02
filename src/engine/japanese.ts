// Assembles the per-line Japanese annotation: analyzer tokens + authored
// reading hints → furigana segments (with provenance) and a romaji line.
// Authored hints win over analyzer readings for both. Pure; no host imports.

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

  for (const token of tokens) {
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
      appendRomaji(romajiParts, tokenRomaji(token.surface, token.readingKana, token.partOfSpeech), token.surface);
    } else {
      // Authored ruby covers exactly the hinted range.
      if (furigana.every((segment) => segment.start !== hint.start)) {
        furigana.push({
          start: hint.start,
          end: hint.end,
          reading: kataToHira(hint.reading),
          origin: "authored",
        });
      }
      appendRomaji(romajiParts, hintTokenRomaji(token, hint), token.surface);
    }
  }

  furigana.sort((a, b) => a.start - b.start);
  return { furigana, romaji: romajiParts.join("") };
}

// The hint replaces the reading of the kanji it covers; kana the token carries
// outside the hinted range (okurigana) keeps its own sound. If the outside
// part is not pure kana we cannot reconstruct the sound, so the hint reading
// alone drives romaji for the covered part and the analyzer reading is
// dropped; authored evidence outranks the analyzer.
function hintTokenRomaji(token: AnalyzerToken, hint: ReadingHint): string {
  const overlapStart = Math.max(token.start, hint.start) - token.start;
  const overlapEnd = Math.min(token.end, hint.end) - token.start;
  const prefix = token.surface.slice(0, overlapStart);
  const suffix = token.surface.slice(overlapEnd);
  const prefixOk = prefix === "" || KANA_ONLY.test(prefix);
  const suffixOk = suffix === "" || KANA_ONLY.test(suffix);
  if (prefixOk && suffixOk) {
    return kanaToRomaji(prefix + hint.reading + suffix);
  }
  return kanaToRomaji(hint.reading);
}

function appendRomaji(parts: string[], romaji: string, surface: string): void {
  if (romaji === "") return;
  const needsNoSpace =
    parts.length === 0 ||
    NO_SPACE_BEFORE.test(surface) ||
    NO_SPACE_AFTER.test(parts[parts.length - 1] ?? "");
  parts.push(needsNoSpace ? romaji : ` ${romaji}`);
}
