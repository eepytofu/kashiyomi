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

export type DictionaryEdition = "small" | "core" | "full";

/**
 * Every edition, **largest first**.
 *
 * The order is the contract: `largestEditionThatFits` walks it and returns the
 * first that fits, and `chooseBootEdition` uses it to pick deterministically
 * rather than trusting whatever order a directory listing arrived in.
 */
export const DICTIONARY_EDITIONS = ["full", "core", "small"] as const;

/**
 * Where an edition's bytes come from.
 *
 * `full` is not a variation on the other two, it is a different supply chain:
 * PyPI carries no wheel for it, so the archive is the vendor's own zip, laid
 * out differently inside, and checked against a digest computed at pin time
 * rather than one the publisher asserted. Modelling that as data keeps the
 * difference in one place instead of as branches through the download path.
 */
export type DictionarySupply = {
  /** How the archive is named inside, which differs between wheel and zip. */
  readonly member: string;
  /** True when only a hash generated at pin time can vouch for the bytes. */
  readonly selfPinned: boolean;
};

export function dictionarySupply(
  edition: DictionaryEdition,
  version: string,
): DictionarySupply {
  if (edition === "full") {
    return {
      member: `sudachi-dictionary-${version}/system_full.dic`,
      selfPinned: true,
    };
  }
  return { member: `sudachidict_${edition}/resources/system.dic`, selfPinned: false };
}

/**
 * The vendor's own distribution host, named by SudachiDict's published sdist.
 *
 * Only `full` needs it, and it is the leg that fails from mainland China
 * (measured: 5/5 vantage points, against pypi.org reachable and google.com
 * blocked as controls), so it must never be tried ahead of PyPI or the mirror.
 */
export const VENDOR_BASE = "https://d2ej7fkh96fzlu.cloudfront.net/sudachidict";

export function vendorArchiveUrl(edition: DictionaryEdition, version: string): string {
  return `${VENDOR_BASE}/sudachi-dictionary-${version}-${edition}.zip`;
}

/** Where PyPI serves the bytes, as opposed to the metadata. */
const PYTHONHOSTED = "https://files.pythonhosted.org";
const MIRROR_HOST = "https://pypi.tuna.tsinghua.edu.cn";

/**
 * The same wheel on the Tsinghua mirror, or undefined if the URL is not one the
 * swap applies to.
 *
 * A host swap rather than a second lookup, **verified rather than assumed**
 * (2026-08-07, both editions): the mirror serves the identical
 * `/packages/<2>/<2>/<64hex>/<file>` path, the identical byte count, and
 * publishes the identical sha256. Its own simple index hands out
 * `../../packages/...`, which resolves to exactly the URL this produces, so the
 * two derivations agree.
 *
 * The hash is checked against the build-time pin either way, so a mirror
 * serving something else cannot install.
 */
export function mirrorUrl(url: string): string | undefined {
  return url.startsWith(`${PYTHONHOSTED}/`)
    ? `${MIRROR_HOST}${url.slice(PYTHONHOSTED.length)}`
    : undefined;
}

/**
 * Every place the bytes can come from, best first.
 *
 * The metadata already fell back across sources; the **archive** did not, so a
 * user who reached PyPI's API and then could not reach its CDN had a download
 * that simply failed with a mirror sitting right there.
 *
 * CloudFront is last wherever it appears, because it is measurably blocked in
 * mainland China (5/5 vantage points, with pypi.org reachable and google.com
 * blocked as controls). It is included **only when the resolved version equals
 * the pinned one**: above that there is no digest to check it against, and an
 * unverifiable 121 MB is not a fallback, it is a liability.
 */
export function downloadUrls(
  release: DictionaryRelease,
  pinnedVersion: string,
): readonly string[] {
  const urls = [release.url];
  const mirror = mirrorUrl(release.url);
  if (mirror) urls.push(mirror);
  const vendor = vendorArchiveUrl(release.edition, release.version);
  if (release.version === pinnedVersion && !urls.includes(vendor)) urls.push(vendor);
  return urls;
}

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
 * Only a wheel is acceptable. An sdist is a ~9 KB stub that fetches the real
 * archive at install time, so it carries no dictionary and its digest vouches
 * for nothing. A release offering only an sdist is treated as absent rather
 * than as something to fall back to. `full` is exactly that case, which is why
 * it resolves through `resolveFullFromPypi` instead.
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

export type FullResolution =
  /** The upstream release is the pinned one, so a digest exists and it installs. */
  | { readonly kind: "pinned"; readonly release: DictionaryRelease }
  /** A newer release exists that no pinned digest can vouch for. */
  | { readonly kind: "newer"; readonly version: string };

/**
 * Resolve `full`, whose metadata and bytes come from different places.
 *
 * PyPI publishes the version but not the archive; the vendor publishes the
 * archive but no digest. So a release is installable exactly when upstream is
 * still on the version this build pinned a self-computed hash for. Anything
 * newer is reported rather than fetched — downloading 121 MB that nothing can
 * verify is the one thing this whole module exists to refuse.
 */
export function resolveFullFromPypi(
  body: unknown,
  pinned: DictionaryRelease,
): FullResolution {
  const version = (body as { info?: { version?: unknown } })?.info?.version;
  if (typeof version !== "string" || version === "" || version === pinned.version) {
    return { kind: "pinned", release: pinned };
  }
  return { kind: "newer", version };
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
