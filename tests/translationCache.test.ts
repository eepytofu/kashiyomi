import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  CACHE_CAP,
  CACHE_KEY,
  cacheClear,
  cacheCount,
  cacheGet,
  cachePut,
  type CacheStorage,
} from "../src/engine/translationCache.ts";

function memoryStorage(options: { maxBytes?: number } = {}): CacheStorage & { raw(): string | null } {
  let store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      if (options.maxBytes !== undefined && value.length > options.maxBytes) {
        throw new Error("QuotaExceededError");
      }
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    raw: () => store.get(CACHE_KEY) ?? null,
  };
}

test("stores and retrieves translations", () => {
  const storage = memoryStorage();
  cachePut(storage, "song-a", ["one", "two"]);
  assert.deepEqual(cacheGet(storage, "song-a", 2), ["one", "two"]);
});

test("misses on unknown keys and line-count mismatch", () => {
  const storage = memoryStorage();
  cachePut(storage, "song-a", ["one", "two"]);
  assert.equal(cacheGet(storage, "song-b", 2), undefined);
  assert.equal(cacheGet(storage, "song-a", 3), undefined);
});

test("entries never expire, however old", () => {
  // There was a 90-day TTL. It could not prevent staleness — the key already
  // covers model, target language and prompt, so a changed setting is a
  // different key — and growth is the cap's job. All it did was re-charge the
  // user for a song they still play. Clear in the settings panel is the
  // on-demand escape hatch, and it is free.
  const storage = memoryStorage();
  const t0 = 1_000_000;
  const tenYears = 10 * 365 * 24 * 60 * 60 * 1000;
  cachePut(storage, "song-a", ["one"], t0);
  assert.deepEqual(cacheGet(storage, "song-a", 1, t0 + tenYears), ["one"]);
  assert.equal(cacheCount(storage), 1);
});

test("a hit refreshes eviction order so it survives eviction", () => {
  const storage = memoryStorage();
  let now = 1_000;
  cachePut(storage, "oldest", ["x"], now);
  for (let i = 0; i < CACHE_CAP - 1; i++) {
    cachePut(storage, `filler-${i}`, ["x"], ++now);
  }
  // Touch the oldest entry, then overflow the cap by one.
  cacheGet(storage, "oldest", 1, ++now);
  cachePut(storage, "newcomer", ["x"], ++now);
  assert.equal(cacheCount(storage), CACHE_CAP);
  assert.deepEqual(cacheGet(storage, "oldest", 1, ++now), ["x"], "touched entry should survive");
  assert.equal(
    cacheGet(storage, "filler-0", 1, ++now),
    undefined,
    "untouched oldest should be evicted",
  );
});

test("cap is enforced", () => {
  const storage = memoryStorage();
  let now = 0;
  for (let i = 0; i < CACHE_CAP + 25; i++) cachePut(storage, `s-${i}`, ["x"], ++now);
  assert.equal(cacheCount(storage), CACHE_CAP);
});

test("clearing empties the cache", () => {
  const storage = memoryStorage();
  cachePut(storage, "song-a", ["one"]);
  cachePut(storage, "song-b", ["two"]);
  assert.equal(cacheCount(storage), 2);
  cacheClear(storage);
  assert.equal(cacheCount(storage), 0);
  assert.equal(cacheGet(storage, "song-a", 1), undefined);
});

test("quota pressure sheds old entries instead of losing everything", () => {
  // Small budget: writing many entries eventually exceeds it.
  const storage = memoryStorage({ maxBytes: 400 });
  let now = 0;
  for (let i = 0; i < 30; i++) cachePut(storage, `s-${i}`, [`line-${i}`], ++now);
  const count = cacheCount(storage);
  assert.ok(count > 0, "cache should retain something after quota pressure");
  assert.ok(count < 30, "cache should have shed entries under quota pressure");
  assert.ok((storage.raw() ?? "").length <= 400);
});

test("corrupt cache data is ignored", () => {
  const storage = memoryStorage();
  storage.setItem(CACHE_KEY, "{not json");
  assert.equal(cacheCount(storage), 0);
  cachePut(storage, "song-a", ["one"]);
  assert.deepEqual(cacheGet(storage, "song-a", 1), ["one"]);
});
