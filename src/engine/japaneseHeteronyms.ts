// Corrects readings where SudachiDict's single entry for a character is the
// wrong one for song lyrics.

import type { AnalyzerToken } from "./tokens.ts";

/** 私 alone reads わたし, not わたくし. */
const WATASHI = "ワタシ";

/** 何 reads なん before a coronal, なに everywhere else. */
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
