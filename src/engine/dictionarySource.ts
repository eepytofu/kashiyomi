// Where the Sudachi dictionary comes from, and what to do when that fails.
//
// Pure policy: no fetch, no filesystem. The host performs the transfer and the
// native side verifies and extracts; everything decidable without doing either
// lives here, so the failure model is covered by `node --test` rather than by
// hoping. See docs for the measurements behind the choices.
//
// Two metadata formats are parsed because the fallback has to survive the
// primary being unreachable, and the mirror speaks a different dialect:
// PyPI's own JSON API, and PEP 691's JSON simple index which mirrors serve.

/**
 * `full` is absent because it cannot use this module's source at all: its bytes
 * are not on PyPI, so it needs its own URL and its own warnings.
 *
 * core is the default for size and for having a vendor-published checksum. It
 * is **not** a claim that core reads lyrics better — that goes both ways.
 */
export type DictionaryEdition = "small" | "core";

/**
 * Every edition, **largest first**.
 *
 * The order is the contract: `largestEditionThatFits` walks it and returns the
 * first that fits, and `chooseBootEdition` uses it to pick deterministically
 * rather than trusting whatever order a directory listing arrived in.
 */
export const DICTIONARY_EDITIONS = ["core", "small"] as const;

export type DictionaryRelease = {
  readonly edition: DictionaryEdition;
  /** SudachiDict release date, e.g. "20260723". */
  readonly version: string;
  readonly url: string;
  readonly sha256: string;
  /** Archive size in bytes. */
  readonly size: number;
};

const PYPI = "https://pypi.org/pypi";
const MIRROR = "https://pypi.tuna.tsinghua.edu.cn/simple";

const packageName = (edition: DictionaryEdition): string => `SudachiDict-${edition}`;

/**
 * Metadata endpoints in the order they should be tried.
 *
 * Ordered by preference, not by geography. Falling back on *failure* rather
 * than on a guess about where the user is means never mis-detecting a VPN
 * user, an expat or a corporate proxy: the mainland reaches the mirror
 * naturally and everyone else never learns it exists.
 */
export function metadataSources(edition: DictionaryEdition): readonly string[] {
  return [
    `${PYPI}/${packageName(edition)}/json`,
    `${MIRROR}/${packageName(edition).toLowerCase()}/`,
  ];
}

/** PEP 691 requires this to get JSON rather than HTML from a simple index. */
export const SIMPLE_INDEX_ACCEPT = "application/vnd.pypi.simple.v1+json";

const WHEEL = /^sudachidict_(small|core)-(\d{8})-/;

/**
 * Read PyPI's own JSON API response.
 *
 * Only a wheel is acceptable. An sdist is a stub that downloads from the
 * vendor's plaintext S3 at install time, which is the host this whole design
 * exists to avoid — so a release offering only an sdist is treated as absent
 * rather than as something to fall back to.
 */
export function parsePypiRelease(
  edition: DictionaryEdition,
  body: unknown,
): DictionaryRelease | undefined {
  const root = body as { info?: { version?: unknown }; urls?: readonly unknown[] };
  const version = typeof root?.info?.version === "string" ? root.info.version : undefined;
  if (version === undefined || !Array.isArray(root.urls)) return undefined;
  for (const entry of root.urls) {
    const file = entry as {
      packagetype?: unknown;
      url?: unknown;
      size?: unknown;
      digests?: { sha256?: unknown };
    };
    if (file.packagetype !== "bdist_wheel") continue;
    const release = buildRelease(edition, version, file.url, file.size, file.digests?.sha256);
    if (release) return release;
  }
  return undefined;
}

/**
 * Read a PEP 691 JSON simple index, which is what the mirrors serve.
 *
 * The index lists every version ever published with no "latest" marker, so the
 * newest is found by the date in the filename rather than by position — the
 * order is not guaranteed and sorting strings would break on a schema change.
 */
export function parseSimpleIndexRelease(
  edition: DictionaryEdition,
  body: unknown,
): DictionaryRelease | undefined {
  const files = (body as { files?: readonly unknown[] })?.files;
  if (!Array.isArray(files)) return undefined;
  let best: DictionaryRelease | undefined;
  for (const entry of files) {
    const file = entry as {
      filename?: unknown;
      url?: unknown;
      size?: unknown;
      hashes?: { sha256?: unknown };
    };
    if (typeof file.filename !== "string") continue;
    const match = WHEEL.exec(file.filename);
    if (!match || match[1] !== edition) continue;
    const release = buildRelease(edition, match[2]!, file.url, file.size, file.hashes?.sha256);
    if (release && (best === undefined || release.version > best.version)) best = release;
  }
  return best;
}

function buildRelease(
  edition: DictionaryEdition,
  version: string,
  url: unknown,
  size: unknown,
  sha256: unknown,
): DictionaryRelease | undefined {
  // A release missing any of these cannot be verified, and an unverifiable
  // dictionary is not installed under any circumstances.
  if (typeof url !== "string" || url === "") return undefined;
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return undefined;
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(sha256)) return undefined;
  return { edition, version, url, sha256, size };
}

/**
 * Bytes that must be free before starting.
 *
 * The archive is downloaded *and then* extracted beside itself, so both exist
 * at once: 68.9 MB plus 207 MB for core. Checking after the download would
 * spend the user's bandwidth before discovering the disk is full, which is the
 * one failure that wastes something unrecoverable.
 *
 * The multiplier is measured, not guessed: core is 68.9 MB compressed against
 * 207.4 MB extracted, small 39.8 against 117.3 — both almost exactly 3x. The
 * margin covers the filesystem and a future release growing slightly.
 */
export function requiredFreeBytes(archiveBytes: number): number {
  const EXTRACTED_RATIO = 3;
  const MARGIN = 64 * 1024 * 1024;
  return archiveBytes + archiveBytes * EXTRACTED_RATIO + MARGIN;
}

/**
 * What to offer when the disk cannot hold the chosen edition.
 *
 * "You need 340 MB" is true and useless. The edition picker is already the
 * remedy — `small` needs about 223 MB against core's 340 — so a machine that
 * cannot fit one may comfortably fit the other, and saying so is more helpful
 * than naming a number and stopping.
 *
 * Returns the largest edition that fits, or undefined when none does. That
 * last case is a real answer rather than a loop to retry: Japanese annotation
 * is unavailable on that machine, while pinyin, kanji repair and translation
 * all keep working, so it is a missing feature and not a broken plugin.
 *
 * `sizes` is whatever the caller managed to resolve; an edition it could not
 * price is not offered, because offering a download whose size is unknown is
 * how a user ends up back here.
 */
export function largestEditionThatFits(
  freeBytes: number,
  sizes: ReadonlyMap<DictionaryEdition, number>,
): DictionaryEdition | undefined {
  for (const edition of DICTIONARY_EDITIONS) {
    const archive = sizes.get(edition);
    if (archive === undefined) continue;
    if (freeBytes >= requiredFreeBytes(archive)) return edition;
  }
  return undefined;
}

export type DictionaryStatus =
  | { readonly kind: "absent" }
  | { readonly kind: "downloading"; readonly received: number; readonly total: number }
  | { readonly kind: "installing" }
  | { readonly kind: "installed"; readonly edition: DictionaryEdition; readonly version: string }
  | { readonly kind: "failed"; readonly reason: DictionaryFailure };

/**
 * Why an install stopped. Separate from the message shown, because the same
 * reason reads differently on a first download and on a failed update — and
 * only `checksum` is a reason to distrust what arrived rather than retry it.
 */
export type DictionaryFailure =
  | "offline"
  | "no-source"
  | "checksum"
  | "disk-space"
  | "extract"
  | "load"
  | "cancelled";

/** Whether the failure is worth offering a retry for, or is a dead end. */
export function isRetryable(reason: DictionaryFailure): boolean {
  // `no-source` means every metadata endpoint refused, so retrying immediately
  // repeats the same two requests; the user has to change something first.
  return reason !== "no-source";
}

/**
 * Whether a downloaded archive may be installed.
 *
 * Deliberately not a boolean parameter list — a mismatch must never be
 * reachable by passing the wrong flag. There is no override, no "install
 * anyway": a corrupt 69 MB download is an annoyance, a silently corrupted
 * dictionary handed to a native analyzer is not.
 */
export function mayInstall(expected: DictionaryRelease, actualSha256: string): boolean {
  return actualSha256.toLowerCase() === expected.sha256.toLowerCase();
}
