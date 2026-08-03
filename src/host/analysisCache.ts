// In-memory cache of line analysis results.
//
// Analysis is deterministic for a given display text, and NCM recycles line
// elements constantly while scrolling, so the same lines would otherwise be
// re-analyzed many times per song. A plain map is enough: the expensive part
// is the one-off dictionary load, not tokenizing a line, and keeping this out
// of storage avoids competing with the translation cache for quota and avoids
// stale results when the dictionary or engine changes.

import type { JapaneseLineAnnotation } from "../engine/japanese.ts";

const ANALYSIS_CACHE_CAP = 600;
const analysisCache = new Map<string, JapaneseLineAnnotation>();

export function cachedAnnotation(text: string): JapaneseLineAnnotation | undefined {
  const hit = analysisCache.get(text);
  if (hit) {
    // Refresh insertion order so active songs survive eviction.
    analysisCache.delete(text);
    analysisCache.set(text, hit);
  }
  return hit;
}

export function rememberAnnotation(text: string, annotation: JapaneseLineAnnotation): void {
  analysisCache.set(text, annotation);
  while (analysisCache.size > ANALYSIS_CACHE_CAP) {
    const oldest = analysisCache.keys().next();
    if (oldest.done) break;
    analysisCache.delete(oldest.value);
  }
}

/** Drop cached analysis (settings that change readings invalidate it). */
export function resetAnalysisCache(): void {
  analysisCache.clear();
}
