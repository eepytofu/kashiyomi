// Turning a Japanese lyric line into the two strings the rest of the pipeline
// needs: what the user sees, and what the analyzer is given.

import { repairJapaneseHan } from "./hanRepair.ts";
import { maskHintBrackets, projectReadingHints, type ReadingHint } from "./hints.ts";
import { kataToHira, usesKatakanaOkurigana } from "./kana.ts";

export type LineTextOptions = {
  /** Rewrite Chinese glyph forms back to Japanese ones (梦见 → 夢見). */
  hanRepair: boolean;
  /** Consume authored readings: 天（そら） displays as 天 and reads そら. */
  readingHints: boolean;
};

export type PreparedJapaneseLine = {
  /** What goes on screen, after repair and hint removal. */
  displayText: string;
  /** Same length as displayText, adjusted so the analyzer can parse it. */
  analysisText: string;
  /** Authored readings to place, empty when the setting is off. */
  hints: readonly ReadingHint[];
};

export function prepareJapaneseLine(
  source: string,
  options: LineTextOptions,
): PreparedJapaneseLine {
  // **Repair always happens for analysis; the setting only chooses what is
  const repaired = repairJapaneseHan(source);
  const shown = options.hanRepair ? repaired : source;

  // With hints on, the annotation is consumed: it leaves the display and
  const projection = projectReadingHints(shown);
  const displayText = options.readingHints ? projection.displayText : shown;
  const hints = options.readingHints ? projection.hints : [];

  // The same projection over the repaired text. Bracket positions are identical
  // in both, because repair only maps Han characters and never touches （）, so
  // this stays the same length as `displayText`.
  const analysed = projectReadingHints(repaired);
  const analysisShown = options.readingHints ? analysed.displayText : repaired;

  // Either way the *analyzer* must not see the brackets. SudachiDict contains
  const unbracketed = options.readingHints ? analysisShown : maskHintBrackets(analysisShown);

  // Katakana-okurigana lines (夜ニ紛レ) are analyzed as hiragana; the conversion
  // is one character to one, so offsets still match what is displayed.
  const analysisText = usesKatakanaOkurigana(unbracketed)
    ? kataToHira(unbracketed)
    : unbracketed;

  return { displayText, analysisText, hints };
}
