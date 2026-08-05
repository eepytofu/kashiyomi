// Which script a piece of text is *written in*, for choosing a font.
//
// This is not routing. `cjk.ts` decides what language a lyric line is, using
// document-level evidence the line itself does not carry (translation presence,
// the document branch, whether the song is bilingual). That question needs the
// whole song. This one is narrower: given a string, which CJK face should it
// render in — and the only evidence available is the string.
//
// Both callers are places where the text is not a lyric, so the ladder in
// `cjk.ts` does not apply: an AI translation we generated, and the credit and
// marker lines we skip.

import { hasChineseOnlyGlyphs, hasJapaneseOnlyGlyphs } from "./hanForms.ts";
import { hasHan, hasKana } from "./kana.ts";

export type ScriptLang = "ja" | "zh" | undefined;

/**
 * Rungs, strongest first. Same shape as the `cjk.ts` ladder over one string
 * instead of a document, and rungs 2 and 3 use the same OpenCC-derived tables,
 * so neither is a hand-typed guess.
 *
 *   1. kana present            -> ja
 *   2. Chinese-only glyph form -> zh
 *   3. Japanese-only glyph form-> ja
 *   4. Han, still ambiguous    -> `hanFallback`, the caller's outside evidence
 *   5. no Han at all           -> undefined, meaning "not CJK, do not tag"
 *
 * Chinese evidence outranks Japanese glyph forms for the reason `cjk.ts` gives:
 * a simplified-only form is unambiguous, while a Japanese form overlaps kyūjitai.
 *
 * Rung 5 returns undefined rather than guessing. Latin has no regional variants,
 * so a caller that gets undefined should leave the element untagged and let it
 * take whatever the surrounding rules give it.
 */
export function labelScript(text: string, hanFallback: ScriptLang): ScriptLang {
  if (hasKana(text)) return "ja";
  if (hasChineseOnlyGlyphs(text)) return "zh";
  if (hasJapaneseOnlyGlyphs(text)) return "ja";
  if (hasHan(text)) return hanFallback;
  return undefined;
}

/**
 * The AI target-language setting as a script tag, for rung 4.
 *
 * Read from the *returned translation* wherever possible and use this only as
 * the fallback: the setting has a free-text Custom option ("Tiếng Việt",
 * "casual English"), so no name-to-tag table can be complete, and a model may
 * ignore the instruction anyway. Only the CJK entries of the panel's own list
 * appear here; everything else is deliberately undefined, which leaves an
 * ambiguous Han-only translation untagged — today's behaviour, so a target this
 * cannot name can never regress.
 */
export function targetLangScript(target: string): ScriptLang {
  const name = target.trim();
  if (name === "简体中文" || name === "繁體中文") return "zh";
  if (name === "日本語") return "ja";
  return undefined;
}
