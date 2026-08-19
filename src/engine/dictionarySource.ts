// Where the Sudachi dictionary comes from, and what to do when that fails.

export type DictionaryEdition = "core" | "full";

/** Core is first because it is the first-run and recovery default. */
export const DICTIONARY_EDITIONS = ["core", "full"] as const;

/** Where the dictionary sits inside the publisher's wheel. */
export function dictionaryMember(edition: DictionaryEdition): string {
  return `sudachidict_${edition}/resources/system.dic`;
}

/** Where PyPI serves the bytes, as opposed to the metadata. */
const PYTHONHOSTED = "https://files.pythonhosted.org";
const MIRROR_HOST = "https://pypi.tuna.tsinghua.edu.cn";

const PYPI = "https://pypi.org/pypi";
const MIRROR = "https://pypi.tuna.tsinghua.edu.cn/simple";

export type DictionaryRelease = {
  readonly edition: DictionaryEdition;
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
 */
export function mirrorUrl(url: string): string | undefined {
  return url.startsWith(`${PYTHONHOSTED}/`)
    ? `${MIRROR_HOST}${url.slice(PYTHONHOSTED.length)}`
    : undefined;
}

/** Every place the bytes can come from, best first. */
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
export function metadataSources(edition: DictionaryEdition): readonly MetadataSource[] {
  // Full is deliberately build-pinned. Unlike Core, PyPI does not publish a
  // self-contained Full wheel; learning a digest from an unrelated runtime
  // source would weaken the boundary the pin exists to provide.
  if (edition === "full") return [];
  const packageName = `SudachiDict-${edition}`;
  return [
    { url: `${PYPI}/${packageName}/json`, kind: "pypi" },
    { url: `${MIRROR}/${packageName.toLowerCase()}/`, kind: "simple" },
  ];
}

/** PEP 691 requires this to get JSON rather than HTML from a simple index. */
export const SIMPLE_INDEX_ACCEPT = "application/vnd.pypi.simple.v1+json";

const WHEEL = /^sudachidict_core-(\d{8})-/;

/** Read PyPI's own JSON API response. */
export function parsePypiRelease(
  edition: DictionaryEdition,
  body: unknown,
): DictionaryRelease | undefined {
  if (edition !== "core") return undefined;
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

/** Read a PEP 691 JSON simple index, which is what the mirrors serve. */
export function parseSimpleIndexRelease(
  edition: DictionaryEdition,
  body: unknown,
): DictionaryRelease | undefined {
  if (edition !== "core") return undefined;
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
    const release = buildRelease(edition, match[1]!, file.url, file.size, file.hashes?.sha256);
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

/** Free space an install needs, archive plus its extraction plus a margin. */
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

/** Whether a downloaded archive may be installed. */
export function mayInstall(expected: DictionaryRelease, actualSha256: string): boolean {
  return actualSha256.toLowerCase() === expected.sha256.toLowerCase();
}
