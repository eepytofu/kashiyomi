// Translation cache policy: TTL, LRU eviction, and recovery when storage is
// full. Storage is injected so this is testable without a browser. Pure logic;
// no host imports.

export type CacheStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/**
 * `at` is when the translation was produced and drives expiry; `used` is the
 * last read and drives eviction order. Keeping them apart means reading a
 * cached song does not extend its freshness indefinitely.
 */
export type CacheEntry = { at: number; used?: number; lines: string[] };
type Envelope = { v: 1; entries: Record<string, CacheEntry> };

function lastUsed(entry: CacheEntry): number {
  return entry.used ?? entry.at;
}

export const CACHE_KEY = "kashiyomi:txcache";
/**
 * Songs kept. Raised from 80 on 2026-08-06 after a live install was found
 * sitting at **78 of 80** — the cap was one song from evicting translations the
 * user had already paid for, which is the opposite of what a cache is for.
 *
 * Measured on that install: 78 songs in 189.9 KB, median entry 2350 bytes,
 * largest 4888. So 500 is roughly 1.2 MB, comfortable against a localStorage
 * budget of several MB that we share with NCM itself. The real safety net is
 * not this number but the quota handler in `persist`, which sheds oldest-first
 * when the browser actually says no.
 */
export const CACHE_CAP = 500;

function emptyEnvelope(): Envelope {
  return { v: 1, entries: {} };
}

export function readEnvelope(storage: CacheStorage): Envelope {
  try {
    const raw = storage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Envelope;
      if (parsed.v === 1 && parsed.entries && typeof parsed.entries === "object") return parsed;
    }
  } catch {
    // Corrupt cache: start over rather than fail the translation.
  }
  return emptyEnvelope();
}

function persist(storage: CacheStorage, envelope: Envelope): void {
  try {
    storage.setItem(CACHE_KEY, JSON.stringify(envelope));
  } catch {
    // Storage full: drop the oldest half and try once more.
    const byAge = Object.keys(envelope.entries).sort(
      (a, b) => lastUsed(envelope.entries[a]!) - lastUsed(envelope.entries[b]!),
    );
    for (const key of byAge.slice(0, Math.ceil(byAge.length / 2))) {
      delete envelope.entries[key];
    }
    try {
      storage.setItem(CACHE_KEY, JSON.stringify(envelope));
    } catch {
      // Caching is best-effort; translation still works without it.
    }
  }
}

/** Look up cached lines, refreshing recency on a hit. */
export function cacheGet(
  storage: CacheStorage,
  key: string,
  expectedLines: number,
  now = Date.now(),
): string[] | undefined {
  const envelope = readEnvelope(storage);
  const entry = envelope.entries[key];
  if (!entry) return undefined;
  if (entry.lines.length !== expectedLines) return undefined;
  entry.used = now;
  persist(storage, envelope);
  return entry.lines;
}

/**
 * Store lines, then enforce the cap, evicting least-recently-used first.
 *
 * **Entries do not expire.** There was a 90-day TTL; it was removed on
 * 2026-08-06 because nothing it did was wanted. It could not be protecting
 * against staleness — the key already covers the lines, provider, model, target
 * language and custom prompt, so changing any of those produces a different key
 * and an old entry can never be served. It could not be bounding growth either;
 * the cap does that. What was left was re-paying for a translation of a song
 * the user still plays, silently and on a timer. A bad translation is already
 * recoverable on demand through Clear in the settings panel, for free.
 */
export function cachePut(
  storage: CacheStorage,
  key: string,
  lines: string[],
  now = Date.now(),
): void {
  const envelope = readEnvelope(storage);
  envelope.entries[key] = { at: now, used: now, lines };
  const keys = Object.keys(envelope.entries);
  if (keys.length > CACHE_CAP) {
    keys
      .sort((a, b) => lastUsed(envelope.entries[a]!) - lastUsed(envelope.entries[b]!))
      .slice(0, keys.length - CACHE_CAP)
      .forEach((entryKey) => delete envelope.entries[entryKey]);
  }
  persist(storage, envelope);
}

export function cacheCount(storage: CacheStorage): number {
  return Object.keys(readEnvelope(storage).entries).length;
}

export function cacheClear(storage: CacheStorage): void {
  try {
    storage.removeItem(CACHE_KEY);
  } catch {
    // Clearing is best-effort, like writing: a cache that refuses to go away
    // is not worth failing the caller over.
  }
}
