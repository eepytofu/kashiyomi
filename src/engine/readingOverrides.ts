// The user's own word→reading list. Pure; no host imports.
//
// This is the last owner of "this song means はるかぜ". No dictionary can settle
// it: 春風 has two legitimate readings, which one a song means is a property of
// the song, so JMdict declines to choose and Sudachi answers シュンプウ. Both are
// behaving correctly.
//
// The rejected fix was *us* shipping a per-word table, which imposes one song's
// intent on everybody. This is the same authority `hints.ts` gives the
// lyricist — 天（そら） — handed to the listener for the words no lyricist wrote
// a hint for.
//
// It sits **above** the dictionary layers and below the lyricist. Precedence,
// strongest first:
//
//   1. an authored hint in the lyric   (hints.ts, applied in japanese.ts)
//   2. a user override                 (here)
//   3. JMdict's single-reading fill    (jmdictReadings.ts)
//   4. the analyzer                    (Sudachi)
//
// A hint outranks an override because it is written in the song: the lyricist
// said so, on that line. An override outranks the dictionaries because they
// have already said they cannot choose.

import { hiraToKata } from "./kana.ts";
import type { AnalyzerToken } from "./tokens.ts";

/**
 * Parse the settings text: one `word=reading` per line.
 *
 * Blank lines and `#` comments are skipped so a list can be annotated. Readings
 * are stored as katakana to match the analyzer's token contract, and accepted in
 * either kana, because nobody typing 春風=はるかぜ should have to think about
 * which one we store.
 *
 * A malformed line is dropped rather than rejecting the whole list — this text
 * is edited by hand in a textarea, and losing every override to one stray line
 * is the worse failure.
 */
export function parseReadingOverrides(text: string): Map<string, string> {
  const overrides = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const at = line.indexOf("=");
    if (at <= 0) continue;
    const word = line.slice(0, at).trim();
    const reading = line.slice(at + 1).trim();
    if (word === "" || reading === "") continue;
    overrides.set(word, hiraToKata(reading));
  }
  return overrides;
}

/**
 * Replace the reading of every token whose surface the user has an entry for.
 *
 * Matched on the whole token surface, never on a substring. 春風 tokenized as
 * 春 + 風 simply does not match, and that is the intended outcome: a substring
 * rule would rewrite 春風 inside 春風亭 (a rakugo stage name) and there is no way
 * to tell from the surface which was meant. Failing to apply an override is
 * visible and correctable; applying it in the wrong place is neither.
 *
 * Unlike `applyJmdictReadings` this **does** override a reading the analyzer
 * produced, because that is the entire point — the analyzer's answer is what the
 * user is disagreeing with.
 */
export function applyReadingOverrides(
  tokens: readonly AnalyzerToken[],
  overrides: ReadonlyMap<string, string>,
): AnalyzerToken[] {
  if (overrides.size === 0) return [...tokens];
  return tokens.map((token) => {
    const reading = overrides.get(token.surface);
    if (reading === undefined || reading === token.readingKana) return token;
    return { ...token, readingKana: reading };
  });
}
