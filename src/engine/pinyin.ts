// Mandarin pinyin via pinyin-pro. The default dictionary misses ordinary

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

/** Words the complete dictionary is missing, layered on top of it. */
const DICT_GAPS: Record<string, [string, number]> = {
  应和: ["yìng hè", 3e-10],
  只应: ["zhǐ yīng", 3e-10],
  只影: ["zhī yǐng", 3e-10],
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
    toneSandhi: true,
  });
  const parts: string[] = [];
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index]!;
    const read = group.map((entry) => entry.result.trim()).filter((piece) => piece !== "");
    if (read.length === 0) continue;
    const pieces = reReadHeteronym(group, read, groups[index - 1], groups[index + 1]);
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

/** 应 standing on its own reads yīng, the modal "ought to / surely", not yìng. */
function readModalAsLevelTone(
  pieces: readonly string[],
  next: readonly SegmentEntry[] | undefined,
): readonly string[] {
  if (pieces[0] !== "yìng") return pieces;
  const following = firstChar(next);
  if (!HAN.test(following) || ASPECT_MARKERS.has(following)) return pieces;
  return ["yīng"];
}

/** A lone 只 reads zhǐ "only", not zhī, the classifier. */
function readLoneZhiAsOnly(
  pieces: readonly string[],
  previous: readonly SegmentEntry[] | undefined,
  next: readonly SegmentEntry[] | undefined,
): readonly string[] {
  if (pieces[0] !== "zhī") return pieces;
  const preceding = [...(previous?.[previous.length - 1]?.origin ?? "")].pop() ?? "";
  if (!HAN.test(firstChar(next)) || DETERMINERS.has(preceding)) return pieces;
  return ["zhǐ"];
}

/** Numerals and demonstratives — everything that can introduce a classifier. */
const DETERMINERS = new Set([..."一二三四五六七八九十百千万两几这那每某半多"]);

function firstChar(group: readonly SegmentEntry[] | undefined): string {
  return [...(group?.[0]?.origin ?? "")][0] ?? "";
}

/** Re-read a heteronym whose single-character fallback is wrong for this text. */
function reReadHeteronym(
  group: readonly SegmentEntry[],
  pieces: readonly string[],
  previous: readonly SegmentEntry[] | undefined,
  next: readonly SegmentEntry[] | undefined,
): readonly string[] {
  if (group.length !== 1) return pieces;
  const char = group[0]?.origin ?? "";
  if (char === "应") return readModalAsLevelTone(pieces, next);
  if (char === "只") return readLoneZhiAsOnly(pieces, previous, next);
  return pieces;
}

/** 道 joins the aspect markers: it is the classical quotative, 应道 "answered". */
const ASPECT_MARKERS = new Set(["了", "着", "过", "道"]);

/** Hyphenate a four-syllable Han word 2+2: wǔwèi-záchén. */
function joinOneWord(pieces: readonly string[], allHan: boolean): string {
  if (!allHan || pieces.length !== 4) return pieces.join("");
  return `${pieces[0]}${pieces[1]}-${pieces[2]}${pieces[3]}`;
}
