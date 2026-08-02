// Authored reading hints: lyrics sometimes carry the intended reading inline,
// e.g. 天(そら)へ. The parenthetical is hidden from the display line and used
// as the furigana/romaji for the word it follows, taking precedence over the
// analyzer. Pure; no host imports.

export type ReadingHint = {
  /** Range of the annotated kanji in the display text (UTF-16 units). */
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

// Kanji run directly followed by a kana-only parenthetical, half- or fullwidth.
// No whitespace allowed between word and paren: a spaced paren is an aside,
// not a reading.
const HINT_PATTERN =
  /([\p{Script=Han}々〆ヵヶ]{1,12})[（(]([ぁ-ゖァ-ヺー]{1,24})[）)]/gu;

const DECORATION_ONLY = /^[\s\p{P}\p{S}]*$/u;
const KANA_ONLY_LOOSE = /^[ぁ-ゖァ-ヺー\s\p{P}\p{S}]*$/u;

/**
 * Extract authored reading hints from a lyric line.
 *
 * Rejections (the annotation stays visible in those cases):
 * - the parenthetical is the tail of the line with nothing but punctuation
 *   after it AND the line otherwise ends in kana; that is a backing-vocal
 *   chant like 勝負服(はっはっ), not a reading;
 * - non-kana inside the parens (never matches the pattern);
 * - whitespace before the paren (never matches the pattern).
 */
export function projectReadingHints(line: string): HintProjection {
  const hints: ReadingHint[] = [];
  let display = "";
  let consumed = 0;
  for (const match of line.matchAll(HINT_PATTERN)) {
    const [full, word, reading] = match as unknown as [string, string, string];
    const index = match.index;
    const tail = line.slice(index + full.length);
    if (DECORATION_ONLY.test(tail) && isChantContext(line, index, word)) {
      continue;
    }
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

// A line-final kana parenthetical after mostly-kana content reads as a chant
// echo (backing vocals), so a reading hint needs the annotated word to carry
// real line context around it.
function isChantContext(line: string, matchIndex: number, word: string): boolean {
  const before = line.slice(0, matchIndex);
  return KANA_ONLY_LOOSE.test(before) && word.length >= 2;
}
