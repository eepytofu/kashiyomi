// The user's own word→reading list. Pure; no host imports.

import { hiraToKata } from "./kana.ts";
import type { AnalyzerToken } from "./tokens.ts";

/** Parse the settings text: one `word=reading` per line. */
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

/** Replace the reading of every token whose surface the user has an entry for. */
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
