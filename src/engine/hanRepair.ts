// Repairs Japanese lyrics stored with **simplified** Chinese glyphs, the
// artifact of lyrics passing through a mainland service: 梦见ては → 夢見ては.
// Display-only: callers keep the original line for matching and caching.
// Pure; no host imports.
//
// Kyūjitai is deliberately left alone. OpenCC's cn→jp runs through a
// traditional pivot, so on its own it also rewrites 407 characters that are
// not simplified at all — 櫻→桜, 佛→仏, 來→来, 傳→伝. Those are not transport
// damage: a lyricist who writes 櫻 or 戀 means it, and modernizing it silently
// edits the song. NetEase is a mainland service and ships simplified on every
// song captured, so the simplified half is the only half that has a job here.

import { isSimplifiedForm, toJapaneseGlyphs } from "./hanForms.ts";

/**
 * Repair Han glyphs in a Japanese-routed line. Only call for lines routed as
 * Japanese; applying this to actual Chinese lyrics would mangle them.
 */
export function repairJapaneseHan(line: string): string {
  if (line === "") return line;
  const converted = toJapaneseGlyphs(line);
  if (converted === line) return line;
  if (converted.length !== line.length) {
    // Every intended mapping is 1:1 in UTF-16 length; a length change means
    // OpenCC did something phrase-level we did not ask for. Abstain.
    //
    // This does fire: sweeping every CJK ideograph found 暅 -> 𣈶 and
    // 毶 -> 𣯶, which are non-BMP and so two UTF-16 units. Without this,
    // every furigana offset after such a character would be shifted by one.
    return line;
  }
  // Take the conversion only where the original character is a simplified
  // form. Everything else — kyūjitai, and characters shared across scripts —
  // is what the uploader wrote, so it stays.
  let repaired = "";
  for (let i = 0; i < line.length; i++) {
    const original = line[i]!;
    repaired += isSimplifiedForm(original) ? converted[i]! : original;
  }
  if (repaired === line) return line;
  // 叶 is a valid Japanese kanji (叶う kanau); OpenCC maps it to 葉 as
  // simplified Chinese. Restore it in front of okurigana that only 叶 takes.
  return repaired.replace(/葉([いうえわお])/gu, "叶$1");
}
