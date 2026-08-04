// Han character form analysis. The same word can be written with Japanese,
// simplified Chinese or traditional Chinese glyph forms, and which forms a
// line uses is evidence about its language. Pure; no host imports.

import * as OpenCC from "opencc-js";

let toJapaneseForms: ((text: string) => string) | undefined;
let toTraditionalForms: ((text: string) => string) | undefined;

/** Convert Chinese glyph forms to their Japanese equivalents. */
export function toJapaneseGlyphs(text: string): string {
  toJapaneseForms ??= OpenCC.Converter({ from: "cn", to: "jp" });
  return toJapaneseForms(text);
}

/** Simplified Chinese to traditional. Used to tell the two apart, not to display. */
export function toTraditionalGlyphs(text: string): string {
  toTraditionalForms ??= OpenCC.Converter({ from: "cn", to: "t" });
  return toTraditionalForms(text);
}

/**
 * True when this character is a *simplified* form, i.e. it has a distinct
 * traditional counterpart. 梦 is (traditional 夢); 繼 is not, it already is the
 * traditional form; 見 is not, it is shared.
 */
export function isSimplifiedForm(ch: string): boolean {
  return toTraditionalGlyphs(ch) !== ch;
}

/**
 * True when the line uses Han forms that Japanese does not: simplified-only
 * shapes, or traditional-only ones such as 虛 where Japanese writes 虚.
 */
export function hasChineseOnlyGlyphs(line: string): boolean {
  return toJapaneseGlyphs(line) !== line;
}

/**
 * Characters written differently in Japanese than in both simplified and
 * traditional Chinese (戦 against 战 and 戰), plus kokuji, which Chinese does
 * not use at all.
 */
// Audited against OpenCC on 2026-08-03 rather than trusted as typed. An entry
// belongs here only if Chinese writes the character differently in *both*
// simplified and traditional. Removed 随 (simplified of 隨), 壮 (simplified of
// 壯) and 糖 (identical in all three scripts) — each made any Chinese line
// containing it look Japanese. 営 was listed twice. 隣 stays: 邻 and 鄰 both
// convert to it, so it really is the Japanese-only form.
const JAPANESE_ONLY_KANJI = new Set([
  ...(
    "戦伝転芸覚実対沢帰単変続読駅験廃髪桜楽薬塩満検険剣権観応圧総経絵浄拡" +
    "児図団囲壊焼犠関闘顕歯売栄営蛍労覧豊悪乗証歳処価仮気辺髄渋巻専従" +
    "縦奨繊荘蔵臓滝択逓鉄弐弁黙訳揺様謡頼竜緑隣霊齢暦錬"
  ),
  ...("働込峠畑辻匂凪雫枠榊麿躾塀笹咲栃搾腺"),
]);

/**
 * The iteration mark repeats the previous character (人々, 磊々落々). It is
 * ordinary in Japanese and effectively unused in modern Chinese lyrics.
 */
const ITERATION_MARK = "々";

/**
 * True when a kana-free line still shows Japanese orthography. Without this,
 * Japanese songs built on four-character compounds (磊々落々 反戦国家) look
 * exactly like literary Chinese.
 */
export function hasJapaneseOnlyGlyphs(line: string): boolean {
  for (const ch of line) {
    if (ch === ITERATION_MARK || JAPANESE_ONLY_KANJI.has(ch)) return true;
  }
  return false;
}
