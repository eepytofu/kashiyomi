// Authored reading hints: lyrics sometimes carry the intended reading inline,
// e.g. 天(そら)へ or 思ゆ(おぼゆ). The parenthetical is hidden from the
// display line and used as the furigana and romaji for the word it follows,
// taking precedence over the analyzer. Pure; no host imports.

import { kataToHira } from "./kana.ts";

export type ReadingHint = {
  /** Range of the annotated word in the display text (UTF-16 units). */
  readonly start: number;
  readonly end: number;
  /** The authored reading, as written (kana). */
  readonly reading: string;
};

export type HintProjection = {
  /** Line with accepted hint annotations removed. */
  readonly displayText: string;
  readonly hints: readonly ReadingHint[];
};

// A kanji run, optionally with trailing okurigana, directly followed by a
// kana-only parenthetical (half- or fullwidth). No whitespace allowed between
// word and paren: a spaced paren is an aside, not a reading.
const HINT_PATTERN =
  /([\p{Script=Han}々〆ヵヶ]{1,12})([ぁ-ゖー]{0,8})[（(]([ぁ-ゖァ-ヺー]{1,24})[）)]/gu;

const DECORATION_ONLY = /^[\s\p{P}\p{S}]*$/u;
const KANA_ONLY_LOOSE = /^[ぁ-ゖァ-ヺー\s\p{P}\p{S}]*$/u;

/**
 * Extract authored reading hints from a lyric line.
 *
 * Rejections (the annotation stays visible in those cases):
 * - the word carries okurigana that the reading does not end with, so the
 *   parenthetical cannot be its reading;
 * - the parenthetical is the tail of the line with nothing but kana and
 *   punctuation before it; that reads as a backing-vocal chant echo like
 *   勝負服(はっはっ), not a reading;
 * - non-kana inside the parens or whitespace before the paren (never match
 *   the pattern).
 */
export function projectReadingHints(line: string): HintProjection {
  const hints: ReadingHint[] = [];
  let display = "";
  let consumed = 0;
  for (const { full, word, reading, index } of acceptedHints(line)) {
    display += line.slice(consumed, index) + word;
    hints.push({
      start: display.length - word.length,
      end: display.length,
      reading,
    });
    consumed = index + full.length;
  }
  display += line.slice(consumed);
  return { displayText: display, hints };
}

/**
 * The line with only the *brackets* of each accepted hint blanked out, same
 * length, for feeding to the analyzer when the display keeps the annotation.
 *
 * Needed because the annotation confuses tokenization: SudachiDict contains
 * 天（そら） as a single entry reading テン, so an untouched line yields one
 * five-character token and a てん ruby smeared across the brackets. Blanking
 * just the brackets leaves 天 and そら as separate words, so the ruby lands on
 * 天 alone and そら still romanizes.
 *
 * Length is preserved because every offset the annotator computes — furigana
 * spans, hint ranges — indexes the displayed text.
 */
export function maskHintBrackets(line: string): string {
  let out = "";
  let consumed = 0;
  for (const { full, word, index } of acceptedHints(line)) {
    // The parenthetical runs from just after the word to the end of the match:
    // word 「（ reading ）」, so the two brackets are its first and last unit.
    const openAt = index + word.length;
    const closeAt = index + full.length - 1;
    out += line.slice(consumed, openAt) + " " + line.slice(openAt + 1, closeAt) + " ";
    consumed = closeAt + 1;
  }
  return out + line.slice(consumed);
}

type AcceptedHint = { full: string; word: string; reading: string; index: number };

/** Hint matches that survive the rejection rules, in order. */
function* acceptedHints(line: string): Generator<AcceptedHint> {
  for (const match of line.matchAll(HINT_PATTERN)) {
    const [full, kanji, okurigana, reading] = match as unknown as [string, string, string, string];
    const word = kanji + okurigana;
    const index = match.index;
    if (okurigana !== "" && !kataToHira(reading).endsWith(kataToHira(okurigana))) {
      continue;
    }
    const tail = line.slice(index + full.length);
    if (DECORATION_ONLY.test(tail) && isChantContext(line, index, word)) {
      continue;
    }
    yield { full, word, reading, index };
  }
}

// A line-final kana parenthetical after mostly-kana content reads as a chant
// echo (backing vocals), so a reading hint needs the annotated word to carry
// real line context around it.
function isChantContext(line: string, matchIndex: number, word: string): boolean {
  const before = line.slice(0, matchIndex);
  return KANA_ONLY_LOOSE.test(before) && word.length >= 2;
}
