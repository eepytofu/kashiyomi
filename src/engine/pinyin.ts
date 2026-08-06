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
  addDict(DICT_GAPS as Parameters<typeof addDict>[0], { name: "kashiyomi-gaps" });
  completeDictRegistered = true;
}

/**
 * Words the complete dictionary is missing, layered on top of it.
 *
 * The bar is a word absent from all 828 dictionary entries for its character,
 * not a reading we would have picked differently. 应和 is the only one so far:
 * without it the segmenter splits 应 + 和 and reads `yìng hé`, wrong in both
 * syllables, and it is also the single counterexample to `readModalAsLevelTone`
 * below — which would turn it into `yīng hé`, wrong in a second way.
 *
 * The number is a corpus frequency, and only its size relative to competing
 * entries matters; 应声 next door is 3.4e-10.
 */
const DICT_GAPS: Record<string, [string, number]> = {
  应和: ["yìng hè", 3e-10],
};

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
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index]!;
    const read = group.map((entry) => entry.result.trim()).filter((piece) => piece !== "");
    if (read.length === 0) continue;
    const pieces = readModalAsLevelTone(group, read, groups[index + 1]);
    if (options.joinWords) {
      parts.push(joinOneWord(pieces, group.every((entry) => HAN.test(entry.origin ?? ""))));
    } else {
      parts.push(...pieces);
    }
  }
  return toLatinPunctuation(parts.join(" "));
}

const HAN = /\p{Script=Han}/u;

type SegmentEntry = { readonly origin?: string; readonly result: string };

/**
 * 应 standing on its own reads yīng, the modal "ought to / surely", not yìng.
 *
 * This is not a new rule; it is the dictionary's own rule reaching a register it
 * does not stock. Of the 828 complete-dict entries containing 应, 232 read it
 * yīng and 310 yìng, and the yīng side is almost entirely one productive
 * pattern — 应 before a predicate: 应为 应予 应从 应作 应允 应尽 应得 应有 应收
 * 应许 应负 应选 应立即. 应是, 应知, 应似 and 应无 are that same pattern in
 * literary Chinese, which lyrics use and the dictionary does not list, so
 * segmentation leaves 应 alone and it falls back to the single-character entry
 * `["yìng", 2.5537e-8]` — one reading, with no alternative to fall back to.
 *
 * The two conditions are grammar, not thresholds. A modal adverb needs a
 * predicate after it, so a line-final 应 is the verb (呼之即应); and a modal
 * cannot carry aspect, so 应 before 了/着/过 is the verb (他应了一声).
 *
 * Measured over 24 lines: 8 corrected, and all 11 genuine yìng readings kept —
 * 有求必应, 一呼百应, 山鸣谷应, 里应外合, 答应, 回应, 响应, 适应, 应邀 are each a
 * dictionary entry and never reach this, and the other two are the guards above.
 *
 * No branch for the tones toggle: the swap is the literal string yìng → yīng,
 * and with `toneType: "none"` both are already `ying`.
 *
 * The bar for adding a second character: attested in a captured song, and a
 * guard that needs no part of speech. 只 was measured against it and rejected.
 * Its dictionary split is the same shape — 261 entries, 55 zhī against 69 zhǐ, a
 * productive 只 + predicate pattern, one reading in the single-character entry —
 * but separating 只应 "only" from 只影 "lone shadow" is verb against noun, and
 * nothing in this pipeline knows a part of speech. A rule there would be a guess
 * in the shape of a grammar rule. 此曲只应天上有 stays wrong on both syllables.
 */
function readModalAsLevelTone(
  group: readonly SegmentEntry[],
  pieces: readonly string[],
  next: readonly SegmentEntry[] | undefined,
): readonly string[] {
  if (group.length !== 1 || group[0]?.origin !== "应" || pieces[0] !== "yìng") return pieces;
  const following = [...(next?.[0]?.origin ?? "")][0] ?? "";
  if (!HAN.test(following) || ASPECT_MARKERS.has(following)) return pieces;
  return ["yīng"];
}

/** 道 joins the aspect markers: it is the classical quotative, 应道 "answered". */
const ASPECT_MARKERS = new Set(["了", "着", "过", "道"]);

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
