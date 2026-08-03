// Turning a Japanese lyric line into the two strings the rest of the pipeline
// needs: what the user sees, and what the analyzer is given.
//
// They are not the same string, and they must be the same *length*. Every
// offset produced by the analyzer indexes the displayed text, so any transform
// here has to map one character to one. That constraint is why brackets are
// blanked rather than removed and why katakana okurigana is converted rather
// than stripped.
//
// Pure, and worth keeping that way: three separate bugs have landed in this
// handful of lines, and none of them could be reproduced without NCM running.

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
  const repaired = options.hanRepair ? repairJapaneseHan(source) : source;

  // With hints on, the annotation is consumed: it leaves the display and
  // becomes the reading. With hints off the lyric is left exactly as NetEase
  // serves it, brackets and all — the setting is about using the author's
  // reading, not about rewriting the line.
  const projection = projectReadingHints(repaired);
  const displayText = options.readingHints ? projection.displayText : repaired;
  const hints = options.readingHints ? projection.hints : [];

  // Either way the *analyzer* must not see the brackets. SudachiDict contains
  // 天（そら） as a single entry reading テン, so an untouched line produced one
  // five-character token and a てん ruby smeared across 天（そら）. Blanking just
  // the brackets keeps the length, so every offset still indexes the display.
  const unbracketed = options.readingHints ? displayText : maskHintBrackets(displayText);

  // Katakana-okurigana lines (夜ニ紛レ) are analyzed as hiragana; the conversion
  // is one character to one, so offsets still match what is displayed.
  const analysisText = usesKatakanaOkurigana(unbracketed)
    ? kataToHira(unbracketed)
    : unbracketed;

  return { displayText, analysisText, hints };
}
