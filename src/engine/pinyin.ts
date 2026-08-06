// Mandarin pinyin via pinyin-pro. The default dictionary misses ordinary
// lexical readings (诗行 is shī háng, not shī xíng), so the host loads the
// complete dictionary (~18MB, kept out of the main bundle) and registers it
// here before romanizing. Pure; no host imports.

import { addDict, OutputFormat, segment } from "pinyin-pro";
import { toLatinPunctuation } from "./latinPunctuation.ts";

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
  // Not just a shortcut: pinyin-pro throws on the empty string. Whitespace is
  // folded in here too so callers never have to care which kind of blank it is.
  if (text.trim() === "") return "";
  const groups = segment(text, {
    format: OutputFormat.AllArray,
    nonZh: "consecutive",
    toneType: options.tones ? "symbol" : "none",
    // 一 and 不 are written with their changed tone in ordinary pinyin: 一个 is
    // yí gè and 不是 is bú shì in dictionaries and teaching material, not yī gè
    // and bù shì. Third-tone sandhi is the opposite convention — 你好 is always
    // written nǐ hǎo even though it is said ní hǎo — and pinyin-pro does not
    // apply it under this flag either way, so enabling this gets the cases
    // orthography marks without introducing the case it does not.
    //
    // The exceptions are handled: 第一 dì yī, 一月 yī yuè, 统一 tǒng yī all keep
    // the plain tone, and 一心一意 comes out yì xīn yí yì.
    toneSandhi: true,
  });
  const parts: string[] = [];
  for (const group of groups) {
    const pieces = group.map((entry) => entry.result.trim()).filter((piece) => piece !== "");
    if (pieces.length === 0) continue;
    if (options.joinWords) {
      parts.push(joinOneWord(pieces, group.every((entry) => HAN.test(entry.origin ?? ""))));
    } else {
      parts.push(...pieces);
    }
  }
  return toLatinPunctuation(parts.join(" "));
}

const HAN = /\p{Script=Han}/u;

/**
 * Hyphenate a four-syllable Han word 2+2: wǔwèi-záchén.
 *
 * This **approximates** GB/T 16159, it does not implement it. The standard
 * hyphenates only an idiom that reads as two disyllabic feet and writes the
 * rest solid (bùyìlèhū), and which class an idiom is in is prosodic, so it is
 * not computable from the dictionary we load. Measured: across eleven idioms
 * that do divide, asking whether each half is itself a dictionary word
 * separated nothing — 层出不穷 and 心旷神怡 have neither half as a word, and
 * 亡羊补牢 has one, exactly like the solid class.
 *
 * So the rule is unconditional and knowingly wrong for the solid minority. It
 * ships anyway because four syllables run together is the one length nobody can
 * parse: wǔwèi-záchén reads, wǔwèizáchén does not. When a captured lyric turns
 * up a real bùyìlèhū, add an explicit exception set here — not a cleverer
 * inference rule, which is the thing already measured and found not to exist.
 * The bar for an entry: a captured lyric containing the idiom, plus a
 * dictionary or the standard itself writing it solid. Not an intuition that
 * one reads better — that is what produced the rule this would carve out of.
 *
 * Longer runs stay joined: they come from one dictionary entry spanning several
 * words (无可奈何花落去 is a single entry), so there is no boundary to cut on and
 * a length cap would just be a magic number.
 */
function joinOneWord(pieces: readonly string[], allHan: boolean): string {
  if (!allHan || pieces.length !== 4) return pieces.join("");
  return `${pieces[0]}${pieces[1]}-${pieces[2]}${pieces[3]}`;
}
