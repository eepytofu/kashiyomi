// AI translation transport and cache. One request per song; results cached
// in localStorage keyed by lyric content and configuration, so replaying a
// song costs nothing.

import {
  buildTranslationPrompt,
  parseTranslationResponse,
  translationCacheKey,
  type TranslationMeta,
} from "../engine/aiTranslation.ts";
import { log } from "./log.ts";
import { getSettings } from "./settings.ts";

import {
  cacheClear,
  cacheCount,
  cacheGet,
  cachePut,
  type CacheStorage,
} from "../engine/translationCache.ts";

const storage: CacheStorage = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => localStorage.removeItem(key),
};

export function cachedTranslationCount(): number {
  return cacheCount(storage);
}

export function clearTranslationCache(): void {
  cacheClear(storage);
}

export function translationConfigured(): boolean {
  const s = getSettings();
  return s.aiApiKey.trim() !== "" && s.aiModel.trim() !== "";
}

/**
 * Translate a whole song. Returns undefined when unconfigured, aborted, or
 * the response violates the line contract; never partial output.
 */
export async function translateSong(
  lines: readonly string[],
  meta: TranslationMeta,
  signal: AbortSignal,
): Promise<string[] | undefined> {
  const s = getSettings();
  if (!translationConfigured() || lines.length === 0) return undefined;

  const key = translationCacheKey(lines, s.aiProvider, s.aiModel, s.aiTargetLang, s.aiCustomPrompt);
  const hit = cacheGet(storage, key, lines.length);
  if (hit) {
    log.debug("translation cache hit");
    return hit;
  }

  const prompt = buildTranslationPrompt(lines, s.aiTargetLang, meta, s.aiCustomPrompt);
  log.info(`translating ${lines.length} lines via ${s.aiProvider}/${s.aiModel}`);
  let raw: string;
  try {
    raw =
      s.aiProvider === "gemini"
        ? await callGemini(s.aiApiKey, s.aiModel, prompt.system, prompt.user, signal)
        : await callOpenAi(s.aiBaseUrl, s.aiApiKey, s.aiModel, prompt.system, prompt.user, signal);
  } catch (err) {
    if (!signal.aborted) log.warn("translation request failed", err);
    return undefined;
  }
  const parsed = parseTranslationResponse(raw, lines.length);
  if (!parsed) {
    log.warn(`translation response violated the ${lines.length}-line contract`);
    return undefined;
  }
  cachePut(storage, key, parsed);
  return parsed;
}

async function callOpenAi(
  baseUrl: string,
  apiKey: string,
  model: string,
  system: string,
  user: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(`${baseUrl.replace(/\/+$/u, "")}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("no content in response");
  return content;
}

async function callGemini(
  apiKey: string,
  model: string,
  system: string,
  user: string,
  signal: AbortSignal,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: 0.3 },
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const parts = data.candidates?.[0]?.content?.parts;
  if (!parts) throw new Error("no candidates in response");
  return parts.map((part) => part.text ?? "").join("");
}
