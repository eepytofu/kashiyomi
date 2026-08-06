// Corrects readings where SudachiDict's single entry for a character is the
// wrong one for song lyrics.
//
// Distinct from `jmdictReadings`, which *fills* readings the analyzer abstained
// on, and from `readingOverrides`, which is the user's own list. This is a
// small set of defaults that are wrong often enough to be worth a rule, each
// measured rather than assumed. Pure; no host imports.
//
// The bar, borrowed from the pinyin side: attested in captured songs, and a
// guard that needs no part of speech. A character that needs to know whether
// the following word is a verb does not qualify, because nothing here knows
// that.

import type { AnalyzerToken } from "./tokens.ts";

/**
 * 私 alone reads わたし, not わたくし.
 *
 * SudachiDict returns `ワタクシ` for the bare 代名詞 in **every** context —
 * 私は, 私が, 私の, 私から all give it. Measured over 514 lyric lines: 12 lone
 * 私 tokens, 12 of them ワタクシ, and every one wanted わたし. On Bad Apple!!
 * alone it lands six times in 27 lines.
 *
 * No positional guard, because none is available and none is needed: this is a
 * register asymmetry, not an ambiguity. わたくし is formal and humble — it is
 * what you say to a court or a customer — while わたし is the ordinary
 * first person. A lyric using わたくし deliberately is possible, and the
 * lyricist's own furigana wins through `hints.ts` when it happens.
 *
 * The compound 私たち already reads ワタシタチ correctly and is untouched,
 * because it never arrives as a lone 私.
 */
const WATASHI = "ワタシ";

/**
 * 何 reads なん before a coronal, なに everywhere else.
 *
 * Sudachi returns `ナン` for the bare 代名詞 unconditionally — it is not
 * context-sensitive, it is one reading on one entry. Measured over the same
 * corpus: 15 lone 何 tokens, 10 of them wrong (何を, 何か, 何も, 何一).
 *
 * The rule is phonological rather than statistical, which is why it can be
 * applied to a common word safely: 何 assimilates to a following coronal —
 * なんだ, なんで, なんの, なんと — and stays なに otherwise: なにが, なにを,
 * なにも, なにより.
 *
 * Two deliberate conservatisms:
 *
 *   - followed by **kanji**, keep ナン. 何人 is なんにん and 何時 is なんじ;
 *     Sudachi usually absorbs these into compounds, but when it does not, なん
 *     is the better guess and this rule should not be the thing that breaks it.
 *   - 何か is genuinely ambiguous — なにか is standard, なんか is colloquial and
 *     common in sung Japanese. It is treated as なに because that is the
 *     standard form, and it is the one case here where a reasonable person
 *     could want the other answer.
 */
const NANI = "ナニ";
const NAN = "ナン";

/** Kana whose initial consonant is coronal: t, d, n. */
const CORONAL = new Set([
  ..."たちつてと",
  ..."だぢづでど",
  ..."なにぬねの",
  ..."タチツテト",
  ..."ダヂヅデド",
  ..."ナニヌネノ",
]);

const HAN = /\p{Script=Han}/u;

/**
 * Apply the corrections. Returns a new array; tokens that need no change are
 * passed through by reference.
 *
 * Runs after JMdict filling and **before** user overrides, so an override
 * always wins over a default chosen here.
 */
export function applyHeteronymDefaults(
  tokens: readonly AnalyzerToken[],
): AnalyzerToken[] {
  return tokens.map((token, index) => {
    const corrected = correctedReading(token, tokens[index + 1]);
    return corrected === undefined ? token : { ...token, readingKana: corrected };
  });
}

function correctedReading(
  token: AnalyzerToken,
  next: AnalyzerToken | undefined,
): string | undefined {
  if (token.surface === "私" && token.readingKana !== WATASHI) return WATASHI;
  if (token.surface !== "何" || token.readingKana !== NAN) return undefined;
  const following = [...(next?.surface ?? "")][0] ?? "";
  // Nothing after it is a bare interrogative: 何？ is なに.
  if (following === "") return NANI;
  if (HAN.test(following) || CORONAL.has(following)) return undefined;
  return NANI;
}
