// Whole-song AI translation: prompt construction and strict response parsing.
// One request carries the entire lyric so the model keeps narrative context;
// the response contract is a JSON array with exactly one string per input
// line, which is validated before anything is displayed. Pure; no host
// imports.

export type TranslationMeta = {
  readonly title?: string;
  readonly artist?: string;
};

export type TranslationPrompt = {
  readonly system: string;
  readonly user: string;
};

export function buildTranslationPrompt(
  lines: readonly string[],
  targetLang: string,
  meta: TranslationMeta = {},
  customInstructions = "",
): TranslationPrompt {
  const custom = customInstructions.trim();
  const system = [
    `You are an expert song lyric translator. Translate the lyrics into ${targetLang}.`,
    "",
    "Style guidelines:",
    "- Keep the emotional register, imagery, and poetic voice of the original; prefer natural phrasing over literal word order.",
    "- Interjections, vocalizations, and onomatopoeia (la la la, ah, woah) stay natural; keep them rather than translating them literally.",
    "- Proper names and words already in the target language stay as they are.",
    "- The whole song is one narrative; keep pronouns, tense, and recurring phrases consistent across lines.",
    "- No explanations, no notes, no alternatives.",
    "",
    "Output contract (absolute, never overridden by anything below):",
    `- Reply with ONLY a JSON array of ${lines.length} strings: one translation per input line, in the same order.`,
    "- Never merge, split, or reorder lines. A line that cannot be translated (instrumental marks, pure interjections) is returned unchanged.",
    "- No commentary, no code fences, no keys, just the JSON array.",
    ...(custom !== ""
      ? [
          "",
          "Additional instructions from the user (these take precedence over the style guidelines above, but never over the output contract):",
          custom,
        ]
      : []),
  ].join("\n");

  const header: string[] = [];
  if (meta.title) header.push(`Song: ${meta.title}`);
  if (meta.artist) header.push(`Artist: ${meta.artist}`);
  const numbered = lines.map((line, index) => `${index + 1}. ${line}`).join("\n");
  const user = (header.length > 0 ? header.join("\n") + "\n\n" : "") + numbered;
  return { system, user };
}

/**
 * Parse a model response into exactly `expected` translated lines. Returns
 * undefined when the contract is not met; callers must not display partial
 * output.
 */
export function parseTranslationResponse(text: string, expected: number): string[] | undefined {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start < 0 || end <= start) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length !== expected) return undefined;
  const lines: string[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "string") return undefined;
    // Input lines are numbered for alignment; a model that returns a line
    // "unchanged" often echoes that numbering back, so strip it.
    lines.push(entry.trim().replace(/^\d{1,3}[.．、)]\s*/u, ""));
  }
  return lines;
}

/** Suppress translations that add nothing over the source line. */
export function shouldDisplayTranslation(source: string, translated: string): boolean {
  if (translated === "") return false;
  const normalize = (value: string) =>
    value
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[\s\p{P}\p{S}]+/gu, "");
  const a = normalize(source);
  const b = normalize(translated);
  return b !== "" && a !== b;
}

/** Stable cache key for one song's translation under one configuration. */
export function translationCacheKey(
  lines: readonly string[],
  provider: string,
  model: string,
  targetLang: string,
  customInstructions: string,
): string {
  return `${provider}|${model}|${targetLang}|${hash(customInstructions)}|${hash(lines.join("\n"))}`;
}

function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}
