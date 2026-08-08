// In-memory cache of line analysis results.

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
