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
//
// **One edition, `core`.** The plugin used to offer small, core and full, and
// most of this file was the machinery for choosing. That choice is where the
// bugs were, and the evidence never justified it: on 514 real lyric lines core
// matches full on 93.6% and is right in all three cases where they differ, with
// an identical OOV rate. What core also has, and full does not, is a PyPI wheel
// and therefore an official mirror — which is why the third-party relay that
// once carried full is gone from here entirely.

/** The package on PyPI. One edition, so this is a constant rather than a lookup. */
const PACKAGE = "SudachiDict-core";

/**
 * Where the dictionary sits inside the wheel.
 *
 * A wheel is a ZIP, so the native extractor treats it the same as any archive;
 * only the member path is specific to the packaging.
 */
export const DICTIONARY_MEMBER = "sudachidict_core/resources/system.dic";

/** Where PyPI serves the bytes, as opposed to the metadata. */
const PYTHONHOSTED = "https://files.pythonhosted.org";
const MIRROR_HOST = "https://pypi.tuna.tsinghua.edu.cn";

const PYPI = "https://pypi.org/pypi";
const MIRROR = "https://pypi.tuna.tsinghua.edu.cn/simple";

export type DictionaryRelease = {
  /** SudachiDict release date, e.g. "20260723". */
  readonly version: string;
  readonly url: string;
  readonly sha256: string;
  /** Archive size in bytes. */
  readonly size: number;
};

/**
 * The same wheel on the Tsinghua mirror, or undefined when the URL is not one
 * the swap applies to.
 *
 * A host swap rather than a second lookup, **verified rather than assumed**
 * (2026-08-07): the mirror serves the identical
 * `/packages/<2>/<2>/<64hex>/<file>` path, the identical byte count, and
 * publishes the identical sha256. Its own simple index hands out
 * `../../packages/...`, which resolves to exactly the URL this produces, so the
 * two derivations agree.
 *
 * This is also the mainland route, and it is an official mirror of the
 * publisher's own index rather than a third party.
 */
export function mirrorUrl(url: string): string | undefined {
  return url.startsWith(`${PYTHONHOSTED}/`)
    ? `${MIRROR_HOST}${url.slice(PYTHONHOSTED.length)}`
    : undefined;
}

/**
 * Every place the bytes can come from, best first.
 *
 * The metadata always fell back across sources; the **archive** did not, so a
 * user who reached PyPI's API and then could not reach its CDN had a download
 * that simply failed with a mirror sitting right there.
 *
 * Falling through on **failure** rather than on a guess about where the user
 * is means never mis-detecting a VPN user, an expat or a corporate proxy: the
 * mainland reaches the mirror naturally and everyone else never learns it
 * exists.
 */
export function downloadUrls(release: DictionaryRelease): readonly string[] {
  const mirror = mirrorUrl(release.url);
  return mirror ? [release.url, mirror] : [release.url];
}

/** How a metadata response has to be read. */
export type MetadataKind = "pypi" | "simple";

export type MetadataSource = { readonly url: string; readonly kind: MetadataKind };

/**
 * Metadata endpoints in the order they should be tried.
 *
 * Same reasoning as `downloadUrls`: preference, not geography.
 */
export function metadataSources(): readonly MetadataSource[] {
  return [
    { url: `${PYPI}/${PACKAGE}/json`, kind: "pypi" },
    { url: `${MIRROR}/${PACKAGE.toLowerCase()}/`, kind: "simple" },
  ];
}

/** PEP 691 requires this to get JSON rather than HTML from a simple index. */
export const SIMPLE_INDEX_ACCEPT = "application/vnd.pypi.simple.v1+json";

const WHEEL = /^sudachidict_core-(\d{8})-/;

/**
 * Read PyPI's own JSON API response.
 *
 * Only a wheel is acceptable. An sdist is a ~9 KB stub that fetches the real
 * archive at install time, so it carries no dictionary and its digest vouches
 * for nothing.
 */
export function parsePypiRelease(body: unknown): DictionaryRelease | undefined {
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
    const release = buildRelease(version, file.url, file.size, file.digests?.sha256);
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
export function parseSimpleIndexRelease(body: unknown): DictionaryRelease | undefined {
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
    if (!match) continue;
    const release = buildRelease(match[1]!, file.url, file.size, file.hashes?.sha256);
    if (release && (best === undefined || release.version > best.version)) best = release;
  }
  return best;
}

function buildRelease(
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
  return { version, url, sha256, size };
}

/**
 * Free space an install needs, archive plus its extraction plus a margin.
 *
 * Checked **before** downloading rather than after, so a full disk does not
 * spend the user's bandwidth before discovering it, which is the one failure
 * that wastes something unrecoverable.
 *
 * The multiplier is measured, not guessed: core is 68.9 MB compressed against
 * 207.4 MB extracted, almost exactly 3x. The margin covers the filesystem and a
 * future release growing slightly.
 */
export function requiredFreeBytes(archiveBytes: number): number {
  const EXTRACTED_RATIO = 3;
  const MARGIN = 64 * 1024 * 1024;
  return archiveBytes + archiveBytes * EXTRACTED_RATIO + MARGIN;
}

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
