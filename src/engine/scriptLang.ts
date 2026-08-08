// Which script a piece of text is *written in*, for choosing a font.

import { hasChineseOnlyGlyphs, hasJapaneseOnlyGlyphs } from "./hanForms.ts";
import { hasHan, hasKana } from "./kana.ts";

export type ScriptLang = "ja" | "zh" | undefined;

/**
 * Rungs, strongest first. Same shape as the `cjk.ts` ladder over one string
 * instead of a document, and rungs 2 and 3 use the same OpenCC-derived tables,
 * so neither is a hand-typed guess.
 */
export function labelScript(text: string, hanFallback: ScriptLang): ScriptLang {
  if (hasKana(text)) return "ja";
  if (hasChineseOnlyGlyphs(text)) return "zh";
  if (hasJapaneseOnlyGlyphs(text)) return "ja";
  if (hasHan(text)) return hanFallback;
  return undefined;
}

/** `labelScript` for a caller that would rather guess than leave text unstyled. */
export function scriptForFont(text: string, fallback: ScriptLang): ScriptLang {
  return labelScript(text, fallback) ?? fallback;
}

/** The AI target-language setting as a script tag, for rung 4. */
export function targetLangScript(target: string): ScriptLang {
  const name = target.trim();
  if (name === "简体中文" || name === "繁體中文") return "zh";
  if (name === "日本語") return "ja";
  return undefined;
}
