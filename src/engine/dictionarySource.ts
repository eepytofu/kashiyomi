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
 * Where the dictionary sits inside the archive.
 *
 * The same shape for every edition, which it was not until 2026-08-07: `full`
 * had a whole separate supply chain, because PyPI cannot host its 126 MB wheel
 * (100 MiB per-file cap) and the only other source was the vendor zip, laid out
 * differently inside and carrying no publisher digest.
 *
 * GitHub Releases carries the wheel for all three, verified by reading the zip
 * central directory over a range request: `sudachidict_full/resources/system.dic`,
 * identical to core and small. So the special case is gone, and with it
 * `selfPinned`, the vendor host, and a 121 MB self-hash at pin time.
 */
export function dictionaryMember(edition: DictionaryEdition): string {
  return `sudachidict_${edition}/resources/system.dic`;
}

/**
 * GitHub Releases: the only host carrying every edition, digests included.
 *
 * Replaced a CloudFront host that was measurably blocked in mainland China
 * (5/5 vantage points, with pypi.org reachable and google.com blocked as
 * controls) and that published no digest at all.
 */
const GITHUB_RELEASES = "https://github.com/WorksApplications/SudachiDict/releases/download";

export function githubAssetUrl(edition: DictionaryEdition, version: string): string {
  return `${GITHUB_RELEASES}/v${version}/${wheelName(edition, version)}`;
}

export function wheelName(edition: DictionaryEdition, version: string): string {
  return `sudachidict_${edition}-${version}-py3-none-any.whl`;
}

/**
 * A third-party relay for GitHub, and the only route by which `full` reaches
 * mainland China at all: it is absent from PyPI and therefore from the Tsinghua
 * mirror too.
 *
 * **Trusted for availability, never for content.** Every download is checked
 * against a digest pinned at build time from what the publisher asserted, so a
 * relay serving anything else fails the check and installs nothing. Verified
 * 2026-08-07 by streaming the whole 126,614,513-byte `full` wheel through it:
 * sha256 matched GitHub's published digest exactly.
 *
 * One endpoint, not the five the operator advertises. They are one operator
 * behind different CDNs, so more of them buys no independence, a dead sub-node
 * redirects to this one within about fifteen minutes on the operator's own
 * account, and the two language versions of their site do not even agree on
 * which sub-nodes exist. Last in every list, so it is reached only when the
 * official hosts have already refused.
 */
const RELAY = "https://gh-proxy.org/";

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
 * Order is official hosts first, then the third-party relay. Every leg is
 * checked against the same digest, so this is a ranking by who should be
 * bothered and who should be trusted to stay up, never by who can be trusted
 * with the bytes: nobody is.
 */
export function downloadUrls(release: DictionaryRelease): readonly string[] {
  const github = githubAssetUrl(release.edition, release.version);
  const urls = [release.url];
  // core and small come from PyPI, so they also exist on the Tsinghua mirror,
  // which is the leg that works from inside mainland China. `full` is on
  // neither: PyPI cannot host a 126 MB file, so nothing mirrors it.
  const mirror = mirrorUrl(release.url);
  if (mirror) urls.push(mirror);
  if (!urls.includes(github)) urls.push(github);
  // Last, always. It is a third party, and it is reached only once every
  // official host has refused.
  urls.push(`${RELAY}${github}`);
  return urls;
}

/**
 * Whether an edition can only be had from GitHub and the relay.
 *
 * True for `full` alone, and the reason is upstream's, not a choice here: PyPI's
 * 100 MiB per-file cap excludes a 126 MB wheel, and every PyPI mirror inherits
 * that absence. Worth saying out loud in the picker, because it is the one
 * edition whose download may involve someone other than the publisher.
 */
export function needsRelay(edition: DictionaryEdition): boolean {
  return edition === "full";
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

/** How a metadata response has to be read. */
export type MetadataKind = "pypi" | "simple" | "github";

export type MetadataSource = {
  readonly url: string;
  readonly kind: MetadataKind;
  /**
   * Whether this source may introduce a release the build has no pin for.
   *
   * **This is the security boundary, and it is not the same one the download
   * list has.** A download is checked against a digest, so any host may serve
   * the bytes. Metadata is where that digest *comes from*, so a source trusted
   * here could hand over `{url: theirs, sha256: hash(theirs)}` and the check
   * would pass against a file nobody vetted.
   *
   * True for the publisher's own index and for a mirror the publisher's index
   * points at, both over HTTPS, both publishing digests verified identical to
   * PyPI's. False for the third-party relay, which is therefore allowed to
   * *confirm* the pinned release and nothing else: the worst it can then do is
   * lie about whether an update exists, which withholds an update rather than
   * installing something.
   */
  readonly trusted: boolean;
};

/**
 * Metadata endpoints in the order they should be tried.
 *
 * Ordered by preference, not by geography. Falling back on *failure* rather
 * than on a guess about where the user is means never mis-detecting a VPN
 * user, an expat or a corporate proxy: the mainland reaches the mirror
 * naturally and everyone else never learns it exists.
 *
 * `full` has only one source, and it is not a shortcut: PyPI publishes its
 * *version* but no installable wheel, so a PyPI answer could never carry the
 * digest an install needs. GitHub is where the artifact and its digest both
 * live.
 */
const GITHUB_API =
  "https://api.github.com/repos/WorksApplications/SudachiDict/releases/latest";

export function metadataSources(edition: DictionaryEdition): readonly MetadataSource[] {
  const github: MetadataSource = { url: GITHUB_API, kind: "github", trusted: true };
  // Reached when GitHub itself is not, which is the mainland case. Untrusted,
  // so it can only confirm the pinned release; measured 2026-08-07 to relay the
  // API intact, digest included, and on its own token rather than the caller's
  // 60-an-hour allowance.
  const relayed: MetadataSource = {
    url: `${RELAY}${GITHUB_API}`,
    kind: "github",
    trusted: false,
  };
  // `full` has no PyPI wheel to describe, so GitHub is its only *trusted*
  // answer. Leaving it at that made the update check fail outright wherever
  // GitHub is blocked, which is precisely where the relay was added for the
  // bytes: relaying one leg and not the other was inconsistent.
  if (edition === "full") return [github, relayed];
  return [
    { url: `${PYPI}/${packageName(edition)}/json`, kind: "pypi", trusted: true },
    { url: `${MIRROR}/${packageName(edition).toLowerCase()}/`, kind: "simple", trusted: true },
    github,
  ];
}

/**
 * What an untrusted source is allowed to have said.
 *
 * Only that the pinned release is still the current one. Version *and* digest
 * must match, and the pinned release is returned rather than the one that came
 * back, so nothing a relay sends is carried forward into an install.
 */
export function confirmsPinned(
  release: DictionaryRelease,
  pinned: DictionaryRelease,
): boolean {
  return release.version === pinned.version && release.sha256 === pinned.sha256;
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
 * than as something to fall back to. `full` is exactly that case: PyPI carries
 * only its sdist stub, so it resolves through GitHub instead.
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

/**
 * Read a GitHub release, which is the only source carrying every edition.
 *
 * The digest matters more than the convenience: GitHub publishes `sha256:…` per
 * asset, so `full` now installs against a hash **the publisher asserted**. Until
 * this existed it was checked against one computed here at pin time, which the
 * pin file admitted only vouched for "the bytes this machine received, not the
 * bytes upstream intended".
 *
 * The tag is `v20260723` and the version inside is `20260723`, so the leading
 * `v` is stripped rather than assumed away.
 */
export function parseGithubRelease(
  edition: DictionaryEdition,
  body: unknown,
): DictionaryRelease | undefined {
  const root = body as { tag_name?: unknown; assets?: readonly unknown[] };
  const tag = typeof root?.tag_name === "string" ? root.tag_name : undefined;
  if (tag === undefined || !Array.isArray(root.assets)) return undefined;
  const version = tag.replace(/^v/u, "");
  const wanted = wheelName(edition, version);
  for (const entry of root.assets) {
    const asset = entry as {
      name?: unknown;
      size?: unknown;
      digest?: unknown;
      browser_download_url?: unknown;
    };
    if (asset.name !== wanted) continue;
    // `sha256:<hex>`; anything else is a digest algorithm this cannot check.
    const digest = typeof asset.digest === "string" ? asset.digest : "";
    if (!digest.startsWith("sha256:")) return undefined;
    return buildRelease(
      edition,
      version,
      asset.browser_download_url,
      asset.size,
      digest.slice("sha256:".length),
    );
  }
  return undefined;
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
