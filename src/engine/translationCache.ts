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

/** Store lines, then enforce the cap, evicting least-recently-used first. */
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
