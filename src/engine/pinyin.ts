// Mandarin pinyin via pinyin-pro. The default dictionary misses ordinary
// lexical readings (诗行 is shī háng, not shī xíng), so the host loads the
// complete dictionary (~18MB, kept out of the main bundle) and registers it
// here before romanizing. Pure; no host imports.

import { addDict, OutputFormat, segment } from "pinyin-pro";

let completeDictRegistered = false;

/** Register the complete dictionary module (from @pinyin-pro/data/complete). */
export function registerCompleteDict(dict: unknown): void {
  if (completeDictRegistered) return;
  addDict(dict as Parameters<typeof addDict>[0], { name: "kashiyomi-complete", dict1: "replace" });
  completeDictRegistered = true;
}

export function isCompleteDictRegistered(): boolean {
  return completeDictRegistered;
}

export type PinyinOptions = {
  /** Tone marks (shī háng) vs bare syllables (shi hang). */
  readonly tones: boolean;
  /**
   * Join syllables that belong to one segmented word (měiyè) instead of
   * spacing every syllable (měi yè).
   */
  readonly joinWords: boolean;
};

/**
 * Romanize a Mandarin line. Non-Han runs (Latin, digits, punctuation) pass
 * through as-is; a space separates every output token.
 */
export function romanizeMandarin(text: string, options: PinyinOptions): string {
  if (text.trim() === "") return "";
  const groups = segment(text, {
    format: OutputFormat.AllArray,
    nonZh: "consecutive",
    toneType: options.tones ? "symbol" : "none",
    toneSandhi: false,
  });
  const parts: string[] = [];
  for (const group of groups) {
    const pieces = group.map((entry) => entry.result.trim()).filter((piece) => piece !== "");
    if (pieces.length === 0) continue;
    if (options.joinWords) {
      parts.push(pieces.join(""));
    } else {
      parts.push(...pieces);
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}
