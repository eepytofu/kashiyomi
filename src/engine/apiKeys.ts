// Multiple API keys with rotation. When one key is rate limited or rejected,
// the next is tried for the same request, and the exhausted key rests before
// being offered again. Pure logic; no host imports.

/** How long a key that hit a limit is pushed to the back of the queue. */
export const KEY_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * Split a user-entered key field into individual keys. Newlines and commas
 * both separate keys so pasting a list works either way.
 */
export function parseApiKeys(value: string): string[] {
  return value
    .split(/[\n,]+/u)
    .map((key) => key.trim())
    .filter((key) => key !== "");
}

/**
 * Order keys so the next attempt starts after the last one that worked, and
 * keys still resting after a limit go last. No key is ever dropped: if every
 * key is resting they are all still returned, because a stale cooldown should
 * never block translation entirely.
 */
export function orderApiKeys(
  keys: readonly string[],
  startIndex: number,
  cooldown: ReadonlyMap<string, number>,
  now: number,
): string[] {
  if (keys.length <= 1) return [...keys];
  const rotated: string[] = [];
  for (let i = 0; i < keys.length; i++) {
    rotated.push(keys[(startIndex + i) % keys.length]!);
  }
  const ready = rotated.filter((key) => (cooldown.get(key) ?? 0) <= now);
  const resting = rotated.filter((key) => (cooldown.get(key) ?? 0) > now);
  return [...ready, ...resting];
}

/**
 * HTTP statuses that mean "this key cannot serve the request, try another":
 * rate limited, out of quota, or rejected outright.
 */
export function isKeyExhaustedStatus(status: number): boolean {
  return status === 429 || status === 402 || status === 401 || status === 403;
}
