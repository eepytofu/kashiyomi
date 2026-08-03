// AI translation transport and cache. One request per song; results cached
// in localStorage keyed by lyric content and configuration, so replaying a
// song costs nothing.

import {
  buildTranslationPrompt,
  parseTranslationResponse,
  translationCacheKey,
  type TranslationMeta,
  type TranslationPrompt,
} from "../engine/aiTranslation.ts";
import { isKeyExhaustedStatus, KEY_COOLDOWN_MS, orderApiKeys, parseApiKeys } from "../engine/apiKeys.ts";
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
  return parseApiKeys(s.aiApiKey).length > 0 && s.aiModel.trim() !== "";
}

/** Keys that recently hit a limit, mapped to when they may be reused. */
const keyCooldown = new Map<string, number>();
let keyCursor = 0;

class KeyExhausted extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

/**
 * Try each configured key in turn until one answers. A key that reports a
 * rate limit, exhausted quota, or rejection is put on cooldown and the next
 * key is tried for the same song.
 */
async function requestWithKeys(
  keys: readonly string[],
  attempt: (key: string) => Promise<string>,
  signal: AbortSignal,
): Promise<string> {
  const ordered = orderApiKeys(keys, keyCursor, keyCooldown, Date.now());
  let lastError: unknown;
  for (const key of ordered) {
    if (signal.aborted) throw new Error("aborted");
    try {
      const result = await attempt(key);
      keyCursor = keys.indexOf(key);
      keyCooldown.delete(key);
      return result;
    } catch (err) {
      if (err instanceof KeyExhausted) {
        keyCooldown.set(key, Date.now() + KEY_COOLDOWN_MS);
        if (keys.length > 1) {
          log.warn(`API key ${maskKey(key)} unavailable (${err.status}); trying the next key`);
        }
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw lastError ?? new Error("no usable API key");
}

function maskKey(key: string): string {
  return key.length <= 8 ? "…" : `${key.slice(0, 4)}…${key.slice(-4)}`;
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
  const keys = parseApiKeys(s.aiApiKey);
  log.info(
    `translating ${lines.length} lines via ${s.aiProvider}/${s.aiModel}` +
      (keys.length > 1 ? ` (${keys.length} keys available)` : ""),
  );
  const buildCall = s.aiProvider === "gemini" ? geminiCall : openAiCall;
  let raw: string;
  try {
    raw = await requestWithKeys(
      keys,
      (key) => send(buildCall({ baseUrl: s.aiBaseUrl, apiKey: key, model: s.aiModel, ...prompt }), signal),
      signal,
    );
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

// ---- providers ---------------------------------------------------------
//
// The two providers differ only in where the request goes, how the key is
// carried, how the prompt is shaped, and where the text sits in the reply.
// `send` owns everything they share, so adding a third provider is a table
// entry rather than another copy of the error handling.

type ProviderRequest = {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  /** Pull the reply text out; throw with a provider-specific reason if absent. */
  readReply: (data: unknown) => string;
};

type CallOptions = TranslationPrompt & {
  baseUrl: string;
  apiKey: string;
  model: string;
};

const TEMPERATURE = 0.3;

function openAiCall({ baseUrl, apiKey, model, system, user }: CallOptions): ProviderRequest {
  return {
    url: `${baseUrl.replace(/\/+$/u, "")}/chat/completions`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: {
      model,
      temperature: TEMPERATURE,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    },
    readReply: (data) => {
      const content = (data as { choices?: { message?: { content?: string } }[] })
        .choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("no content in response");
      return content;
    },
  };
}

function geminiCall({ apiKey, model, system, user }: CallOptions): ProviderRequest {
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    headers: { "Content-Type": "application/json" },
    body: {
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: TEMPERATURE },
    },
    readReply: (data) => {
      const parts = (data as { candidates?: { content?: { parts?: { text?: string }[] } }[] })
        .candidates?.[0]?.content?.parts;
      if (!parts) throw new Error("no candidates in response");
      return parts.map((part) => part.text ?? "").join("");
    },
  };
}

async function send(request: ProviderRequest, signal: AbortSignal): Promise<string> {
  const response = await fetch(request.url, {
    method: "POST",
    signal,
    headers: request.headers,
    body: JSON.stringify(request.body),
  });
  if (!response.ok) {
    // A key-specific refusal is recoverable: requestWithKeys tries the next
    // key for the same song. Anything else fails the request outright.
    if (isKeyExhaustedStatus(response.status)) throw new KeyExhausted(response.status);
    throw new Error(`HTTP ${response.status}`);
  }
  return request.readReply(await response.json());
}
