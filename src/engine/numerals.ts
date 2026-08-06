// Readings for kanji numerals, and the sound changes they trigger against a
// following counter. Pure; no host imports.
//
// SudachiDict returns numerals as 名詞,数詞 with **no reading at all** and an OOV
// flag, so 三人 comes back as 三[∅] 人[ニン]: the furigana lands on the counter
// alone and the romaji row shows the raw kanji ("三 nin no shoujo"). Numerals
// are systematic, so this is a rule rather than a dictionary.
//
// Measured 2026-08-04 against 150 ground-truth fixtures: counters scored 2/10
// and numeric assimilation 0/6 before this module existed.

const DIGITS: Record<string, string> = {
  〇: "ぜろ", 零: "れい",
  一: "いち", 二: "に", 三: "さん", 四: "よん", 五: "ご",
  六: "ろく", 七: "なな", 八: "はち", 九: "きゅう",
};

/** Powers that scale a preceding digit: 三百 is さんびゃく, not さん + ひゃく. */
const SMALL_POWERS: Record<string, string> = { 十: "じゅう", 百: "ひゃく", 千: "せん" };
const LARGE_POWERS: Record<string, string> = { 万: "まん", 億: "おく", 兆: "ちょう" };

/**
 * Sound changes between a digit and the power that follows it. Japanese
 * numerals assimilate: 六百 is ろっぴゃく, 八千 is はっせん, 三百 is さんびゃく.
 */
const POWER_EUPHONY: Record<string, Record<string, string>> = {
  十: { 一: "いちじゅう", 八: "はちじゅう" },
  百: { 三: "さんびゃく", 六: "ろっぴゃく", 八: "はっぴゃく" },
  千: { 三: "さんぜん", 八: "はっせん" },
};

/** A bare power with no digit in front reads as itself: 十 is じゅう. */
const BARE_POWER: Record<string, string> = { 十: "じゅう", 百: "ひゃく", 千: "せん" };

/**
 * Arabic digits, halfwidth and fullwidth. Lyrics write both, and the analyzer
 * abstains on them exactly as it does on kanji numerals: 21グラム comes back
 * 21[∅] グラム, and 3匹 comes back 3[∅] 匹[ヒキ], which voices as "3 hiki"
 * instead of さんびき.
 */
const ARABIC = /^[0-9０-９]+$/u;

/** Convert an Arabic run to the kanji numeral that reads the same way. */
function arabicToKanji(text: string): string {
  const digits = [...text].map((c) => "0123456789".indexOf(c) >= 0
    ? "0123456789".indexOf(c)
    : "０１２３４５６７８９".indexOf(c));
  if (digits.some((d) => d < 0)) return "";
  // Only sizes the euphony rules cover; beyond that the reading is not worth
  // guessing and the caller keeps the analyzer's answer.
  if (digits.length > 4 || digits[0] === 0) return "";
  const KANJI = "〇一二三四五六七八九";
  const POWERS = ["", "十", "百", "千"];
  let out = "";
  digits.forEach((d, idx) => {
    const power = POWERS[digits.length - 1 - idx]!;
    if (d === 0) return;
    // 十/百/千 with a leading one are written bare: 21 is 二十一, not 二十一.
    out += (d === 1 && power !== "") ? power : KANJI[d]! + power;
  });
  return out;
}

/** True when every character is part of a kanji numeral. */
export function isKanjiNumeral(text: string): boolean {
  if (text === "") return false;
  for (const ch of text) {
    if (!(ch in DIGITS) && !(ch in SMALL_POWERS) && !(ch in LARGE_POWERS)) return false;
  }
  return true;
}

/** True when the text is a numeral this module can read, in either script. */
export function isNumeral(text: string): boolean {
  return isKanjiNumeral(text) || (ARABIC.test(text) && arabicToKanji(text) !== "");
}

/** The kanji form of a numeral written either way, for rule lookup. */
function asKanjiNumeral(text: string): string {
  if (isKanjiNumeral(text)) return text;
  return ARABIC.test(text) ? arabicToKanji(text) : "";
}

/**
 * Reading for a kanji numeral, in hiragana. Returns "" when the text is not a
 * numeral this module is confident about — callers must fail closed rather
 * than render a guess.
 */
export function readKanjiNumeral(text: string): string {
  const kanji = asKanjiNumeral(text);
  if (kanji === "") return "";
  const chars = [...kanji];
  let out = "";
  let pendingDigit = "";
  for (const ch of chars) {
    if (ch in DIGITS) {
      // Two digits in a row are a digit sequence (一二三), not a number.
      if (pendingDigit !== "") out += DIGITS[pendingDigit]!;
      pendingDigit = ch;
      continue;
    }
    if (ch in SMALL_POWERS) {
      const euphony = pendingDigit !== "" ? POWER_EUPHONY[ch]?.[pendingDigit] : undefined;
      if (euphony) out += euphony;
      else if (pendingDigit !== "") out += DIGITS[pendingDigit]! + SMALL_POWERS[ch]!;
      else out += BARE_POWER[ch]!;
      pendingDigit = "";
      continue;
    }
    // 万/億/兆 take the digits before them as written: 三万 is さんまん.
    if (pendingDigit !== "") out += DIGITS[pendingDigit]!;
    pendingDigit = "";
    out += LARGE_POWERS[ch]!;
  }
  if (pendingDigit !== "") out += DIGITS[pendingDigit]!;
  return out;
}

/**
 * Whole-phrase readings for a numeral plus counter, where the pair is
 * irregular enough that no rule produces it. Calendar days are the worst
 * offenders: 一日 is ついたち, 二十日 is はつか.
 */
const COUNTED_PHRASE: Record<string, string> = {
  一人: "ひとり", 二人: "ふたり",
  一日: "ついたち", 二日: "ふつか", 三日: "みっか", 四日: "よっか", 五日: "いつか",
  六日: "むいか", 七日: "なのか", 八日: "ようか", 九日: "ここのか", 十日: "とおか",
  十四日: "じゅうよっか", 二十日: "はつか", 二十四日: "にじゅうよっか",
  二十歳: "はたち", 一昨日: "おととい", 明後日: "あさって",
};

/**
 * Sound changes a counter undergoes after a digit. The counter's own reading
 * is what the analyzer supplied; this only says how the pair is voiced.
 */
const COUNTER_EUPHONY: Record<string, Record<string, string>> = {
  ほん: { 一: "いっぽん", 三: "さんぼん", 六: "ろっぽん", 八: "はっぽん", 十: "じゅっぽん" },
  ぽん: { 一: "いっぽん", 三: "さんぼん", 六: "ろっぽん", 八: "はっぽん", 十: "じゅっぽん" },
  ひき: { 一: "いっぴき", 三: "さんびき", 六: "ろっぴき", 八: "はっぴき", 十: "じゅっぴき" },
  はい: { 一: "いっぱい", 三: "さんばい", 六: "ろっぱい", 八: "はっぱい", 十: "じゅっぱい" },
  ばい: { 一: "いっぱい", 三: "さんばい", 六: "ろっぱい", 八: "はっぱい", 十: "じゅっぱい" },
  かい: { 一: "いっかい", 六: "ろっかい", 八: "はっかい", 十: "じゅっかい" },
  さつ: { 一: "いっさつ", 八: "はっさつ", 十: "じゅっさつ" },
};

/**
 * Reading for a numeral immediately followed by a counter, given the counter's
 * own reading from the analyzer. Returns "" when nothing is known, so the
 * caller keeps the analyzer's own answer.
 */
export function readCountedPhrase(
  numeral: string,
  counter: string,
  counterReading: string,
): string {
  const kanji = asKanjiNumeral(numeral);
  const whole = COUNTED_PHRASE[numeral + counter] ?? COUNTED_PHRASE[kanji + counter];
  if (whole) return whole;
  if (kanji === "") return "";
  // Assimilation is driven by the *last* digit, not the whole number: 21匹 is
  // にじゅういっぴき, so the rule fires on 一 while 二十 is read normally in
  // front of it.
  const chars = [...kanji];
  const tail = chars[chars.length - 1]!;
  const euphony = COUNTER_EUPHONY[counterReading]?.[tail];
  if (euphony) {
    const head = chars.slice(0, -1).join("");
    const headReading = head === "" ? "" : readKanjiNumeral(head);
    // A head we cannot read would silently drop digits, so abstain instead.
    if (head !== "" && headReading === "") return "";
    return headReading + euphony;
  }
  const digits = readKanjiNumeral(numeral);
  if (digits === "" || counterReading === "") return "";
  return digits + counterReading;
}

/** Whole-phrase reading for a standalone form such as 二十歳 or 一昨日. */
export function readKnownPhrase(text: string): string {
  return COUNTED_PHRASE[text] ?? "";
}
