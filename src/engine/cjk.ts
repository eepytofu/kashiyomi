// Per-line CJK routing: decide whether a lyric line should get Japanese
// readings, pinyin, or nothing. Document context matters because Han-only
// lines are ambiguous between Chinese and kanji-only Japanese lines.
// Pure; no host imports.

import { hasHan, hasKana } from "./kana.ts";

export type CjkDocumentBranch = "japanese" | "chinese" | undefined;
export type CjkLineRoute = "japanese" | "chinese" | undefined;

/**
 * Classify the whole lyric document. A couple of kana lines mark the song as
 * Japanese; a clear majority of Han-only lines marks it as Chinese. A small
 * Japanese island must not flip an otherwise Chinese document, so Chinese
 * needs both an absolute floor and a 2:1 advantage.
 */
export function resolveDocumentBranch(lines: readonly string[]): CjkDocumentBranch {
  let kanaLines = 0;
  let hanOnlyLines = 0;
  for (const line of lines) {
    if (hasKana(line)) kanaLines += 1;
    else if (hasHan(line)) hanOnlyLines += 1;
  }
  if (kanaLines === 0 && hanOnlyLines === 0) return undefined;
  if (hanOnlyLines >= 2 && hanOnlyLines >= kanaLines * 2) return "chinese";
  if (kanaLines >= 1) return "japanese";
  return "chinese";
}

/**
 * Route one line given the document context. Kana in the line forces
 * Japanese; Han-only lines follow the document branch.
 */
export function resolveLineRoute(line: string, doc: CjkDocumentBranch): CjkLineRoute {
  const kana = hasKana(line);
  const han = hasHan(line);
  if (!kana && !han) return undefined;
  if (kana) return "japanese";
  return doc ?? "chinese";
}
