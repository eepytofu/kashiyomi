// Repairs Japanese lyrics stored with Chinese-codepoint Han glyphs, a common
// artifact of lyrics passing through Chinese services: 梦见ては → 夢見ては,
// 櫻 → 桜. Uses OpenCC's cn→jp conversion (simplified and traditional both
// normalize to shinjitai through the traditional pivot), which is verified to
// be identity on already-correct Japanese text. Display-only: callers keep
// the original line for matching and caching. Pure; no host imports.

import * as OpenCC from "opencc-js";

let converter: ((text: string) => string) | undefined;

function cnToJp(text: string): string {
  converter ??= OpenCC.Converter({ from: "cn", to: "jp" });
  return converter(text);
}

/**
 * Repair Han glyphs in a Japanese-routed line. Only call for lines routed as
 * Japanese; applying this to actual Chinese lyrics would mangle them.
 */
export function repairJapaneseHan(line: string): string {
  if (line === "") return line;
  let repaired = cnToJp(line);
  if (repaired === line) return line;
  if (repaired.length !== line.length) {
    // Every intended mapping is 1:1 in UTF-16 length; a length change means
    // OpenCC did something phrase-level we did not ask for. Abstain.
    return line;
  }
  // 叶 is a valid Japanese kanji (叶う kanau); OpenCC maps it to 葉 as
  // simplified Chinese. Restore it in front of okurigana that only 叶 takes.
  repaired = repaired.replace(/葉([いうえわお])/gu, "叶$1");
  return repaired;
}
