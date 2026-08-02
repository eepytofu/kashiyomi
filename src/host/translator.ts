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

const CACHE_KEY = "kashiyomi:txcache";
const CACHE_CAP = 40;

type CacheEnvelope = {
  v: 1;
  entries: Record<string, { at: number; lines: string[] }>;
};

function readCache(): CacheEnvelope {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as CacheEnvelope;
      if (parsed.v === 1 && parsed.entries) return parsed;
    }
  } catch {
    // fall through to a fresh cache
  }
  return { v: 1, entries: {} };
}

function writeCache(cache: CacheEnvelope): void {
  const keys = Object.keys(cache.entries);
  if (keys.length > CACHE_CAP) {
    keys
      .sort((a, b) => cache.entries[a]!.at - cache.entries[b]!.at)
      .slice(0, keys.length - CACHE_CAP)
      .forEach((key) => delete cache.entries[key]);
  }
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // cache is best-effort
  }
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
  const cache = readCache();
  const hit = cache.entries[key];
  if (hit && hit.lines.length === lines.length) {
    log.debug("translation cache hit");
    return hit.lines;
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
  cache.entries[key] = { at: Date.now(), lines: parsed };
  writeCache(cache);
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
