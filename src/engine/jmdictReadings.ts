// A lexical reading layer over the analyzer's output. Pure; no host imports.

import { HAN_CHAR, hiraToKata } from "./kana.ts";
import type { AnalyzerToken } from "./tokens.ts";

/** Surface → its single JMdict reading. Built by the export tool. */
export type JmdictReadings = {
  readonly get: (surface: string) => string | undefined;
};

/**
 * Build a lookup from the exported asset. A Map rather than the parsed object:
 * a bare object would answer `get("constructor")` with something from the
 * prototype, and `Object.hasOwn` is not available in CEF 91.
 */
export function jmdictReadings(map: Readonly<Record<string, string>>): JmdictReadings {
  const table = new Map(Object.entries(map));
  return { get: (surface) => table.get(surface) };
}

/**
 * Fill readings the analyzer abstained on, returning a new token stream.
 * Ranges and surfaces are untouched, so the result still satisfies
 * `assertAnalyzerTokens` against the same text.
 */
export function applyJmdictReadings(
  tokens: readonly AnalyzerToken[],
  readings: JmdictReadings,
): AnalyzerToken[] {
  return tokens.map((token) => {
    // Kana-only surfaces have nothing to look up: the reading is the surface.
    if (!HAN_CHAR.test(token.surface)) return token;
    const found = readings.get(token.surface);
    if (found === undefined) return token;
    const reading = hiraToKata(found);

    // Fill an abstention. The analyzer produced no reading, so there is no
    if (token.readingKana === "") return { ...token, readingKana: reading };

    return token;
  });
}
