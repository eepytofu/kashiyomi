// Assembles the per-line Japanese annotation: analyzer tokens + authored
// reading hints, producing furigana segments (with provenance) and a romaji
// line. Authored hints win over analyzer readings for both. Pure; no host
// imports.

import { alignFurigana } from "./furigana.ts";
import { kanaToRomaji } from "./romaji.ts";
import { KANA_ONLY, kataToHira } from "./kana.ts";
import type { ReadingHint } from "./hints.ts";
import { assertAnalyzerTokens, type AnalyzerToken } from "./tokens.ts";
import { latinizeSegments } from "./latinPunctuation.ts";
import { isNumeral, readCountedPhrase, readKanjiNumeral, readKnownPhrase } from "./numerals.ts";


/**
 * Reading for a numeral at `index`, taking the following counter token with it
 * when the pair is irregular or assimilates. Returns undefined when this is not
 * a numeral the module is confident about, so the caller falls through to the
 * analyzer's own answer.
 */
function numeralReading(
  tokens: readonly AnalyzerToken[],
  index: number,
): { reading: string; surface: string; end: number; tokensUsed: number } | undefined {
  const token = tokens[index]!;
  // Only step in where the analyzer abstained; a numeral it can read already
  // (二十歳 → ハタチ) is not ours to second-guess.
  if (token.readingKana !== "" || !isNumeral(token.surface)) return undefined;

  const next = tokens[index + 1];
  if (next) {
    const paired = readKnownPhrase(token.surface + next.surface)
      || readCountedPhrase(token.surface, next.surface, kataToHira(next.readingKana));
    if (paired !== "") {
      return { reading: paired, surface: token.surface + next.surface, end: next.end, tokensUsed: 2 };
    }
  }
  const alone = readKanjiNumeral(token.surface);
  if (alone === "") return undefined;
  return { reading: alone, surface: token.surface, end: token.end, tokensUsed: 1 };
}

export type LineFuriganaSegment = {
  /** Range in the display line (UTF-16 units). */
  readonly start: number;
  readonly end: number;
  readonly reading: string;
  /** Authored = provided in the lyric source (rendered distinctly). */
  readonly origin: "inferred" | "authored";
};

export type RomajiSegment = {
  /** Includes its own leading space when one separates it from the left. */
  readonly text: string;
  readonly origin: "inferred" | "authored";
};

export type JapaneseLineAnnotation = {
  readonly furigana: readonly LineFuriganaSegment[];
  readonly romaji: string;
  /** Same content as `romaji`, split where provenance changes. */
  readonly romajiSegments: readonly RomajiSegment[];
};

const NO_SPACE_BEFORE = /^[、。，．！？!?…・：;；:）)」』ー~〜]/u;
const NO_SPACE_AFTER = /[（(「『、。，．！？…・]$/u;

/**
 * Annotate one display line. `tokens` must be the analyzer output for exactly
 * this text (fail-closed if not). `hints` come from projectReadingHints on
 * the same text.
 */
export function annotateJapaneseLine(
  displayText: string,
  tokens: readonly AnalyzerToken[],
  hints: readonly ReadingHint[] = [],
): JapaneseLineAnnotation {
  assertAnalyzerTokens(displayText, tokens);

  const furigana: LineFuriganaSegment[] = [];
  const romajiParts: RomajiSegment[] = [];
  // A token-final っ geminates the next token's first consonant (回っ + て is
  // mawatte, not "mawat te"), so the sokuon carries across the boundary and
  // the two parts join without a space.
  let sokuonCarry = false;

  const voice = (kana: string, isFinal: boolean): { romaji: string; joined: boolean } => {
    let hira = kataToHira(kana);
    const joined = sokuonCarry;
    if (sokuonCarry) {
      hira = "っ" + hira;
      sokuonCarry = false;
    }
    if (!isFinal && hira.endsWith("っ")) {
      hira = hira.slice(0, -1);
      sokuonCarry = true;
    }
    return { romaji: kanaToRomaji(hira), joined };
  };

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i]!;
    const hint = hints.find((h) => h.start < token.end && h.end > token.start);
    if (!hint) {
      // SudachiDict returns numerals as 数詞 with no reading at all, so 三人
      // arrives as 三[∅] 人[ニン]: ruby lands on the counter alone and the
      // romaji row shows the bare kanji. Numerals are rule-governed, so read
      // them here, taking the following counter with them when the pair has a
      // sound change (三匹 is さんびき, not さん + ひき).
      const numeral = numeralReading(tokens, i);
      if (numeral) {
        furigana.push({
          start: token.start,
          end: numeral.end,
          reading: numeral.reading,
          origin: "inferred",
        });
        const { romaji, joined } = voice(numeral.reading, numeral.tokensUsed + i === tokens.length);
        appendRomaji(romajiParts, romaji, numeral.surface, joined, "inferred");
        i += numeral.tokensUsed;
        continue;
      }
      for (const segment of alignFurigana(token.surface, token.readingKana)) {
        furigana.push({
          start: token.start + segment.start,
          end: token.start + segment.end,
          reading: segment.reading,
          origin: "inferred",
        });
      }
      const special = particleSpecial(token);
      if (special !== undefined) {
        sokuonCarry = false;
        appendRomaji(romajiParts, special, token.surface, false, "inferred");
      } else {
        const kana = token.readingKana !== "" ? token.readingKana : token.surface;
        const { romaji, joined } = voice(kana, i === tokens.length - 1);
        appendRomaji(romajiParts, romaji, token.surface, joined, "inferred");
      }
      i += 1;
      continue;
    }

    // Group every consecutive token this hint overlaps and treat the run as
    // one authored unit, so a hint spanning multiple tokens is voiced once.
    let last = i;
    while (last + 1 < tokens.length && tokens[last + 1]!.start < hint.end) last += 1;
    const runStart = token.start;
    const runEnd = tokens[last]!.end;

    // The authored reading goes through the same okurigana anchoring as
    // inferred readings, so in 思ゆ(おぼゆ) the ruby おぼ lands on 思 only.
    const hintSurface = displayText.slice(hint.start, hint.end);
    const authored = alignFurigana(hintSurface, hint.reading);
    if (authored.length > 0) {
      for (const segment of authored) {
        furigana.push({
          start: hint.start + segment.start,
          end: hint.start + segment.end,
          reading: segment.reading,
          origin: "authored",
        });
      }
    } else {
      furigana.push({
        start: hint.start,
        end: hint.end,
        reading: kataToHira(hint.reading),
        origin: "authored",
      });
    }

    // Kana the token run carries outside the hinted word keeps its own sound.
    // If that context is not pure kana its sound cannot be reconstructed, so
    // the authored reading alone is voiced; it outranks the analyzer.
    const prefix = displayText.slice(runStart, Math.max(runStart, hint.start));
    const suffix = displayText.slice(Math.min(runEnd, hint.end), runEnd);
    const prefixOk = prefix === "" || KANA_ONLY.test(prefix);
    const suffixOk = suffix === "" || KANA_ONLY.test(suffix);
    const voicedKana = prefixOk && suffixOk ? prefix + hint.reading + suffix : hint.reading;
    const { romaji, joined } = voice(voicedKana, last === tokens.length - 1);
    appendRomaji(romajiParts, romaji, displayText.slice(runStart, runEnd), joined, "authored");
    i = last + 1;
  }

  furigana.sort((a, b) => a.start - b.start);
  // Romaji is Latin script, so CJK marks become Latin ones and pick up Latin
  // spacing. Done over the segments so the coloured authored line and the
  // plain line cannot disagree.
  const latinized = latinizeSegments(romajiParts);
  return {
    furigana,
    romaji: latinized.map((part) => part.text).join(""),
    romajiSegments: latinized,
  };
}

// Hepburn particle spellings; everything else voices from its reading.
function particleSpecial(token: AnalyzerToken): string | undefined {
  if (token.partOfSpeech !== "particle") return undefined;
  const surface = kataToHira(token.surface);
  if (surface === "は") return "wa";
  if (surface === "へ") return "e";
  if (surface === "を") return "wo";
  return undefined;
}

function appendRomaji(
  parts: RomajiSegment[],
  romaji: string,
  surface: string,
  joinPrevious: boolean,
  origin: RomajiSegment["origin"],
): void {
  if (romaji === "") return;
  const needsNoSpace =
    joinPrevious ||
    parts.length === 0 ||
    NO_SPACE_BEFORE.test(surface) ||
    NO_SPACE_AFTER.test(parts[parts.length - 1]?.text ?? "");
  parts.push({ text: needsNoSpace ? romaji : ` ${romaji}`, origin });
}
