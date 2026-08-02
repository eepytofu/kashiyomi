// Hiragana → romaji in the wapuro-Hepburn style common in fan lyric romaji:
// long vowels stay spelled out (とうきょう → toukyou), sokuon doubles the next
// consonant (って → tte, っち → tchi), ん becomes n (n' before vowels and y).
// Pure; no host imports.

import { kataToHira } from "./kana.ts";

const DIGRAPHS: Record<string, string> = {
  きゃ: "kya", きゅ: "kyu", きょ: "kyo",
  ぎゃ: "gya", ぎゅ: "gyu", ぎょ: "gyo",
  しゃ: "sha", しゅ: "shu", しょ: "sho",
  じゃ: "ja", じゅ: "ju", じょ: "jo",
  ちゃ: "cha", ちゅ: "chu", ちょ: "cho",
  ぢゃ: "ja", ぢゅ: "ju", ぢょ: "jo",
  にゃ: "nya", にゅ: "nyu", にょ: "nyo",
  ひゃ: "hya", ひゅ: "hyu", ひょ: "hyo",
  びゃ: "bya", びゅ: "byu", びょ: "byo",
  ぴゃ: "pya", ぴゅ: "pyu", ぴょ: "pyo",
  みゃ: "mya", みゅ: "myu", みょ: "myo",
  りゃ: "rya", りゅ: "ryu", りょ: "ryo",
  ふぁ: "fa", ふぃ: "fi", ふぇ: "fe", ふぉ: "fo",
  うぃ: "wi", うぇ: "we", うぉ: "wo",
  ゔぁ: "va", ゔぃ: "vi", ゔぇ: "ve", ゔぉ: "vo",
  てぃ: "ti", でぃ: "di", とぅ: "tu", どぅ: "du",
  しぇ: "she", じぇ: "je", ちぇ: "che",
};

const MONOGRAPHS: Record<string, string> = {
  あ: "a", い: "i", う: "u", え: "e", お: "o",
  か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
  が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go",
  さ: "sa", し: "shi", す: "su", せ: "se", そ: "so",
  ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
  た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
  だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do",
  な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no",
  は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
  ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",
  ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
  や: "ya", ゆ: "yu", よ: "yo",
  ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro",
  わ: "wa", ゐ: "wi", ゑ: "we", を: "wo",
  ゔ: "vu",
  ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o",
  ゃ: "ya", ゅ: "yu", ょ: "yo", ゎ: "wa",
};

const VOWELS = new Set(["a", "i", "u", "e", "o"]);

/** Convert kana text to romaji. Non-kana characters pass through unchanged. */
export function kanaToRomaji(kana: string): string {
  const text = kataToHira(kana);
  const chars = [...text];
  let out = "";
  let pendingSokuon = false;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (ch === "っ") {
      pendingSokuon = true;
      continue;
    }
    if (ch === "ー") {
      const lastVowel = [...out].reverse().find((c) => VOWELS.has(c));
      out += lastVowel ?? "";
      continue;
    }
    if (ch === "ん") {
      const next = chars[i + 1];
      const nextRomaji = next ? DIGRAPHS[next + (chars[i + 2] ?? "")] ?? MONOGRAPHS[next] : undefined;
      const nextStart = nextRomaji?.[0];
      out += nextStart && (VOWELS.has(nextStart) || nextStart === "y") ? "n'" : "n";
      continue;
    }
    const pair = i + 1 < chars.length ? ch + chars[i + 1]! : "";
    let syllable = pair && DIGRAPHS[pair] !== undefined ? DIGRAPHS[pair] : undefined;
    if (syllable !== undefined) {
      i += 1;
    } else {
      syllable = MONOGRAPHS[ch];
    }
    if (syllable === undefined) {
      pendingSokuon = false;
      out += ch;
      continue;
    }
    if (pendingSokuon) {
      out += syllable.startsWith("ch") ? "t" : syllable[0]!;
      pendingSokuon = false;
    }
    out += syllable;
  }
  if (pendingSokuon) out += "t"; // line-final っ (lyric interjections like あっ)
  return out;
}

/**
 * Romaji for one analyzed token, applying the particle spellings Hepburn
 * requires: は→wa, へ→e, を→wo (lyric convention keeps "wo").
 */
export function tokenRomaji(surface: string, readingKana: string, partOfSpeech: string): string {
  if (partOfSpeech === "particle") {
    const s = kataToHira(surface);
    if (s === "は") return "wa";
    if (s === "へ") return "e";
    if (s === "を") return "wo";
  }
  return kanaToRomaji(readingKana !== "" ? readingKana : surface);
}
