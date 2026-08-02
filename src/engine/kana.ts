// Kana classification and conversion. Pure; no host imports.

const KATAKANA_START = 0x30a1;
const KATAKANA_END = 0x30f6;
const KATA_TO_HIRA_OFFSET = 0x60;

/** Convert katakana to hiragana; everything else (incl. ー) passes through. */
export function kataToHira(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    out += code >= KATAKANA_START && code <= KATAKANA_END
      ? String.fromCodePoint(code - KATA_TO_HIRA_OFFSET)
      : ch;
  }
  return out;
}

export const KANA_CHAR = /[ぁ-ゖァ-ヺーゝゞヽヾ]/u;
export const KANA_ONLY = /^[ぁ-ゖァ-ヺーゝゞヽヾ]+$/u;

/** Han ideographs plus the marks that behave like kanji inside words. */
export const HAN_CHAR = /[\p{Script=Han}々〆ヵヶ]/u;
export const HAN_ONLY = /^[\p{Script=Han}々〆ヵヶ]+$/u;

export function hasKana(text: string): boolean {
  return KANA_CHAR.test(text);
}

export function hasHan(text: string): boolean {
  return HAN_CHAR.test(text);
}
