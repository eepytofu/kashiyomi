// A lexical reading layer over the analyzer's output. Pure; no host imports.
//
// Analyzer lexicons store **one reading per entry, chosen to make parsing
// work**; a lexical dictionary stores **all** readings for a surface. That is a
// difference in kind, and it is where the accuracy left over after Round 5 of
// `ANALYZERS.md` lives.
//
// The whole safety argument rests on one filter, applied when the asset is
// built (`tools/export-jmdict-readings.mjs`): a surface is included **only when
// JMdict lists exactly one reading for it**. Where a surface has several, this
// layer holds no opinion and the analyzer's answer stands. So the layer can
// never *choose* a reading — it can only supply one that was never in dispute.
//
// That is what keeps it clear of the trap measured in Round 1: taking JMdict's
// *first* reading blindly would rewrite 空 → から, 僕 → しもべ, 風 → ふり, all
// of which Sudachi already gets right. Those surfaces carry 4, 4 and several
// readings respectively, so none of them is in the asset at all.
//
// It is also why 春風 stays シュンプウ. It has two readings (はるかぜ,
// しゅんぷう), which reading a song means belongs to that song, and the escape
// hatch is the lyricist's: 春風（はるかぜ） via `hints.ts`.
//
// **This layer only fills abstentions. It never overrides a reading the
// analyzer produced.** Two override rules were written, measured and rejected;
// both are recorded in `ANALYZERS.md` because both looked convincing first.
//
// 1. Correct any uninflected disagreement. It demoted 秋桜 from コスモス to
//    アキザクラ — both are real readings, and JMdict recording only one does
//    not make the other wrong. "JMdict has exactly one reading" means JMdict
//    records one, not that the language has one.
// 2. Correct only where the analyzer reached its reading by deciding the
//    surface is a personal name (`固有名詞,人名`). This fixed 常世 → トコヨ in
//    三千世界 常世之闇, but its premise — that a surface JMdict carries is
//    ordinary vocabulary rather than a name — is false. 蓮 and 千秋 are both,
//    and it rewrote them to ハス and センシュウ wherever they were used as
//    names. No cheap signal separates the cases: the breakage happens after
//    plain particles (蓮が, 千秋を) and at end of line, so an honorific guard
//    does not help. Lyrics are full of personal names, so the exposure is real.
//
// Filling an abstention is safe in a way neither of those is: there is no
// competing answer to be wrong about.

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
    // competing answer to override and no way to do worse than the blank it
    // left. This is what closes 磊々 → らいらい, which stays OOV in sentence
    // context and not just in isolation.
    if (token.readingKana === "") return { ...token, readingKana: reading };

    return token;
  });
}
