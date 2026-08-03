// Spacing compensation for ruby-justified lines.
//
// Native ruby cannot shrink a reading, so when a reading is wider than the
// word it annotates, Blink justifies the *base* out to match: 千本桜 under
// せんぼんざくら renders as 千 本 桜. The space between phrases does not grow
// with it. Past a certain furigana size a word's internal gaps become as wide
// as the space between words, the phrase boundary stops reading as a boundary,
// and adjacent readings collide (せんぼんざくら running into よる).
//
// The fix is not to suppress the stretch — that would mean shrinking readings
// to fit, which at the sizes people actually use makes them unreadable. It is
// to keep real spaces ahead of the gaps ruby opens up inside words.

import type { LineFuriganaSegment } from "./japanese.ts";

/**
 * Guard against a pathological segment (a single kanji under a very long
 * reading at a large size) turning one space into a chasm.
 */
const MAX_WORD_SPACING_EM = 1.5;

/**
 * Blink lets a reading overhang its ruby box instead of pushing the base out
 * to the reading's full width, so a word stretches less than the raw width
 * difference suggests.
 *
 * Measured in NCM (22px base, 75% readings, so a 16.5px reading character) via
 * the layout dump over a 42-line sample: 千本桜/せんぼんざくら 8.1px,
 * 環状線/かんじょうせん 8.3px, 禅定門/ぜんじょうもん 8.1px,
 * 花魁道中/おいらんどうちゅう 7.6px — consistently half a reading character.
 * Subtracting it predicts every measured stretch to under a pixel; leaving it
 * out overstates the compensation by about 20%.
 */
const RT_OVERHANG_CHARS = 0.5;

/**
 * Extra `word-spacing`, in em, that a line needs so its spaces stay visibly
 * wider than the widest gap ruby opens inside one of its words. Returns 0 when
 * no reading is wider than its base, which is the common case.
 *
 * `rtScale` is the furigana font size as a fraction of the base (0.75 for the
 * 75% setting).
 *
 * Widths are counted in em of the base font: CJK bases and kana readings are
 * both full-width, so an n-character base occupies n em and a k-character
 * reading at scale s occupies k*s em.
 *
 * The result is deliberately *not* the full boundary width. `word-spacing` is
 * added on top of the space character's natural width, so a line whose widest
 * internal gap is g ends up with a boundary of (natural + g), which is always
 * greater than g. That keeps the guarantee without having to hardcode how wide
 * a space renders in whichever font the user picked.
 */
export function rubyWordSpacingEm(
  segments: readonly LineFuriganaSegment[],
  rtScale: number,
): number {
  if (!(rtScale > 0)) return 0;
  let widest = 0;
  for (const segment of segments) {
    const baseChars = segment.end - segment.start;
    if (baseChars <= 0) continue;
    // Count code points: a reading is kana, but surrogate pairs elsewhere
    // would otherwise inflate the width.
    const readingChars = Array.from(segment.reading).length;
    const stretch =
      readingChars * rtScale - baseChars - RT_OVERHANG_CHARS * rtScale;
    if (stretch <= 0) continue;
    // The stretch is distributed around the base rather than only between its
    // characters, so an n-character base spreads it across n units, not n-1.
    // Dividing by n-1 gave a two-character word the entire stretch as a single
    // gap: 悪霊/あくりょう produced 30.25px on 悪霊退散 ICBM, by far the widest
    // boundary in the song and visibly too much. A single character has no
    // interior at all, so its stretch shows as padding either side and only
    // half of it reads as a gap.
    const gap = baseChars > 1 ? stretch / baseChars : stretch / 2;
    if (gap > widest) widest = gap;
  }
  return Math.min(widest, MAX_WORD_SPACING_EM);
}
