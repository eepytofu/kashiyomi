import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  isRetryable,
  largestEditionThatFits,
  mayInstall,
  metadataSources,
  parsePypiRelease,
  parseSimpleIndexRelease,
  requiredFreeBytes,
  confirmsPinned,
  dictionaryMember,
  downloadUrls,
  mirrorUrl,
  parseGithubRelease,
  githubAssetUrl,
  type DictionaryRelease,
} from "../src/engine/dictionarySource.ts";

// Shapes captured from the real endpoints on 2026-08-06, trimmed to the fields
// the parser reads. Inventing these would be inventing the format.
const PYPI_CORE = {
  info: { name: "SudachiDict-core", version: "20260723" },
  urls: [
    {
      packagetype: "bdist_wheel",
      url: "https://files.pythonhosted.org/packages/46/fe/68a1/sudachidict_core-20260723-py3-none-any.whl",
      size: 72275897,
      digests: { sha256: "b3869ce6b12b4bfa09575dc19030703b0000000000000000000000000000abcd" },
    },
    { packagetype: "sdist", url: "https://example/sdist.tar.gz", size: 4096, digests: { sha256: "f".repeat(64) } },
  ],
};

const SIMPLE_CORE = {
  files: [
    {
      filename: "sudachidict_core-20260428-py3-none-any.whl",
      url: "https://pypi.tuna.tsinghua.edu.cn/packages/aa/sudachidict_core-20260428-py3-none-any.whl",
      size: 71000000,
      hashes: { sha256: "a".repeat(64) },
    },
    {
      filename: "sudachidict_core-20260723-py3-none-any.whl",
      url: "https://pypi.tuna.tsinghua.edu.cn/packages/46/sudachidict_core-20260723-py3-none-any.whl",
      size: 72275897,
      hashes: { sha256: "b".repeat(64) },
    },
  ],
};

test("pypi metadata yields a verifiable release", () => {
  const release = parsePypiRelease("core", PYPI_CORE);
  assert.equal(release?.version, "20260723");
  assert.equal(release?.size, 72275897);
  assert.match(release?.url ?? "", /\.whl$/u);
});

test("an sdist is never accepted as a source", () => {
  // SudachiDict-full ships only an sdist, and that sdist downloads from a
  // plaintext host with no checksum at install time. Treating it as absent is
  // the whole reason `full` is not offered.
  const sdistOnly = { info: { version: "20260723" }, urls: [PYPI_CORE.urls[1]] };
  assert.equal(parsePypiRelease("core", sdistOnly), undefined);
});

test("the mirror index picks the newest release, not the last listed", () => {
  const release = parseSimpleIndexRelease("core", SIMPLE_CORE);
  assert.equal(release?.version, "20260723");
  // Reversing the file order must not change the answer: the index gives no
  // ordering guarantee, so position must not be load-bearing.
  const reversed = { files: [...SIMPLE_CORE.files].reverse() };
  assert.equal(parseSimpleIndexRelease("core", reversed)?.version, "20260723");
});

test("the mirror index does not confuse editions", () => {
  assert.equal(parseSimpleIndexRelease("small", SIMPLE_CORE), undefined);
});

test("a release missing anything needed to verify it is rejected", () => {
  const base = PYPI_CORE.urls[0]!;
  const missing = (patch: Record<string, unknown>) =>
    parsePypiRelease("core", { info: { version: "20260723" }, urls: [{ ...base, ...patch }] });
  assert.equal(missing({ digests: {} }), undefined, "no hash");
  assert.equal(missing({ digests: { sha256: "not-hex" } }), undefined, "malformed hash");
  assert.equal(missing({ size: 0 }), undefined, "zero size");
  assert.equal(missing({ url: "" }), undefined, "no url");
});

test("garbage responses do not throw", () => {
  // Every one of these is a real possibility when a captive portal or a proxy
  // answers instead of the registry.
  for (const body of [undefined, null, "", 42, [], {}, { files: "nope" }, { urls: {} }]) {
    assert.equal(parsePypiRelease("core", body), undefined);
    assert.equal(parseSimpleIndexRelease("core", body), undefined);
  }
});

test("sources are ordered by preference, with the mirror second", () => {
  const sources = metadataSources("core");
  assert.deepEqual(sources.map((s) => s.kind), ["pypi", "simple", "github"]);
  assert.match(sources[0]!.url, /^https:\/\/pypi\.org\//u);
  assert.match(sources[1]!.url, /tsinghua/u);
  // Lowercased for the simple index, which is case-normalised per PEP 503.
  assert.match(sources[1]!.url, /sudachidict-core/u);
});

// PyPI knows full's version but can never serve it, so an answer from there
// could not carry the digest an install needs. GitHub is the only source, and
// leaving it at that made the update check fail outright wherever GitHub is
// blocked, which is the same place the relay was added for the bytes.
test("full checks github, then github through the relay", () => {
  const sources = metadataSources("full");
  assert.deepEqual(sources.map((s) => s.kind), ["github", "github"]);
  assert.ok(sources[1]!.url.startsWith("https://gh-proxy.org/"));
});

// The security boundary, and it is not the download list's. A download is
// checked against a digest, so any host may serve bytes. Metadata is where that
// digest comes from, so a source trusted here could hand over
// `{url: theirs, sha256: hash(theirs)}` and the check would pass against a file
// nobody vetted.
test("only the publisher and its own mirrors are trusted to name a release", () => {
  for (const edition of ["small", "core", "full"] as const) {
    for (const source of metadataSources(edition)) {
      const isRelay = source.url.startsWith("https://gh-proxy.org/");
      assert.equal(source.trusted, !isRelay, `${edition} ${source.url}`);
    }
  }
});

test("an untrusted source may confirm the pin and nothing else", () => {
  const pinned: DictionaryRelease = {
    edition: "full",
    version: "20260723",
    url: "https://github.com/x/full.whl",
    sha256: "c".repeat(64),
    size: 126614513,
  };
  assert.equal(confirmsPinned(pinned, pinned), true);
  // A newer version has no pin to check it against, and the source offering it
  // is the same one that would supply the digest.
  assert.equal(confirmsPinned({ ...pinned, version: "20261115" }, pinned), false);
  // The version matching is not enough: a swapped digest is the whole attack.
  assert.equal(confirmsPinned({ ...pinned, sha256: "d".repeat(64) }, pinned), false);
});

test("free space is checked for archive plus extraction, not just the download", () => {
  // core: 68.9 MB archive, 207.4 MB extracted, and both exist at once.
  const archive = 72275897;
  const needed = requiredFreeBytes(archive);
  assert.ok(needed > archive * 4, "must cover the extracted copy as well");
  assert.ok(needed < archive * 5, "but not demand an absurd amount");
});

test("a full disk is answered with a smaller edition, not just a number", () => {
  // Real archive sizes, 2026-08-06. core needs ~340 MB free, small ~223 MB.
  const sizes = new Map([["core", 72275897], ["small", 41750000]] as const);
  const MB = 1024 * 1024;
  assert.equal(largestEditionThatFits(500 * MB, sizes), "core", "plenty of room");
  assert.equal(largestEditionThatFits(300 * MB, sizes), "small", "core will not fit, small does");
  assert.equal(largestEditionThatFits(50 * MB, sizes), undefined, "neither fits");
  // An edition whose size could not be resolved is not offered: a download of
  // unknown size is how a user ends up back at a full disk.
  assert.equal(largestEditionThatFits(500 * MB, new Map()), undefined);
  assert.equal(
    largestEditionThatFits(300 * MB, new Map([["core", 72275897]] as const)),
    undefined,
    "core does not fit and small was not priced",
  );
});

test("a checksum mismatch can never be installed", () => {
  const release: DictionaryRelease = {
    edition: "core",
    version: "20260723",
    url: "https://example/x.whl",
    sha256: "b".repeat(64),
    size: 10,
  };
  assert.equal(mayInstall(release, "b".repeat(64)), true);
  assert.equal(mayInstall(release, "B".repeat(64)), true, "hex case is not a mismatch");
  assert.equal(mayInstall(release, "c".repeat(64)), false);
  assert.equal(mayInstall(release, ""), false);
});

test("only a dead end is unretryable", () => {
  assert.equal(isRetryable("no-source"), false);
  for (const reason of ["offline", "checksum", "disk-space", "extract", "load", "cancelled"] as const) {
    assert.equal(isRetryable(reason), true, reason);
  }
});

// --- one supply chain for every edition -------------------------------------

// Until 2026-08-07 `full` was extracted from a differently shaped vendor zip.
// GitHub Releases carries the wheel for every edition, verified by reading the
// zip central directory over a range request, so there is one shape now.
test("every edition holds its dictionary at the same path inside the wheel", () => {
  assert.equal(dictionaryMember("core"), "sudachidict_core/resources/system.dic");
  assert.equal(dictionaryMember("small"), "sudachidict_small/resources/system.dic");
  assert.equal(dictionaryMember("full"), "sudachidict_full/resources/system.dic");
});

test("the github asset url is the published wheel name under a v-prefixed tag", () => {
  assert.equal(
    githubAssetUrl("full", "20260723"),
    "https://github.com/WorksApplications/SudachiDict/releases/download/v20260723/sudachidict_full-20260723-py3-none-any.whl",
  );
});

const GITHUB_BODY = {
  tag_name: "v20260723",
  assets: [
    {
      name: "sudachidict_core-20260723-py3-none-any.whl",
      size: 72275897,
      digest: "sha256:" + "b".repeat(64),
      browser_download_url: "https://github.com/x/core.whl",
    },
    {
      name: "sudachidict_full-20260723-py3-none-any.whl",
      size: 126614513,
      digest: "sha256:" + "c".repeat(64),
      browser_download_url: "https://github.com/x/full.whl",
    },
  ],
};

// The point of the GitHub source: `full` finally has a digest the *publisher*
// asserted, where before it was checked against one computed locally at pin
// time, vouching only for the bytes that machine happened to receive.
test("a github release yields a full release with a publisher digest", () => {
  const release = parseGithubRelease("full", GITHUB_BODY);
  assert.ok(release);
  assert.equal(release.version, "20260723", "the leading v is stripped from the tag");
  assert.equal(release.sha256, "c".repeat(64));
  assert.equal(release.size, 126614513);
});

test("a github release picks the asset for the edition asked for", () => {
  assert.equal(parseGithubRelease("core", GITHUB_BODY)?.sha256, "b".repeat(64));
  assert.equal(parseGithubRelease("small", GITHUB_BODY), undefined);
});

// Same standard as every other source: unverifiable bytes are not installed.
// The fixture matters more than it looks. A missing digest, `md5:abc` and a
// sha512 are all rejected by the 64-hex check further down whether or not the
// algorithm is ever inspected, so they pass with the guard deleted and prove
// nothing. Only a digest that is **well formed but not sha256** reaches the
// guard: a seven-character prefix followed by 64 valid hex, which is what a
// future algorithm change would look like, and which would otherwise be handed
// to the verifier as though it were a sha256.
test("a github asset whose digest is not sha256 is refused", () => {
  const wrongAlgorithm = {
    tag_name: "v20260723",
    assets: [{ ...GITHUB_BODY.assets[1], digest: "blake3:" + "a".repeat(64) }],
  };
  assert.equal(parseGithubRelease("full", wrongAlgorithm), undefined);

  for (const digest of [undefined, "", "md5:abc", "sha512:" + "a".repeat(128), "sha256:nope"]) {
    const body = {
      tag_name: "v20260723",
      assets: [{ ...GITHUB_BODY.assets[1], digest }],
    };
    assert.equal(parseGithubRelease("full", body), undefined, String(digest));
  }
});

test("junk from github resolves to nothing rather than throwing", () => {
  for (const body of [null, {}, { tag_name: "v1" }, { assets: [] }, { tag_name: 5, assets: [] }]) {
    assert.equal(parseGithubRelease("full", body), undefined, JSON.stringify(body));
  }
});

// D21: the metadata fell back across sources from the start; the archive never
// did, so reaching PyPI's API and then failing at its CDN was a dead download
// with a working mirror one host swap away.
test("a pythonhosted wheel gains a mirror, verified to serve the same path", () => {
  const url =
    "https://files.pythonhosted.org/packages/46/fe/68a1/sudachidict_core-20260723-py3-none-any.whl";
  assert.equal(
    mirrorUrl(url),
    "https://pypi.tuna.tsinghua.edu.cn/packages/46/fe/68a1/sudachidict_core-20260723-py3-none-any.whl",
  );
});

test("a url that is not pythonhosted has no mirror to swap to", () => {
  assert.equal(mirrorUrl("https://d2ej7fkh96fzlu.cloudfront.net/sudachidict/x.zip"), undefined);
  assert.equal(mirrorUrl("https://example.invalid/x.whl"), undefined);
});

const WHEEL_RELEASE = {
  edition: "core",
  version: "20260723",
  url: "https://files.pythonhosted.org/packages/46/fe/68a1/sudachidict_core-20260723-py3-none-any.whl",
  sha256: "b".repeat(64),
  size: 72275897,
} as const;

const FULL_RELEASE = {
  edition: "full",
  version: "20260723",
  url: "https://github.com/WorksApplications/SudachiDict/releases/download/v20260723/sudachidict_full-20260723-py3-none-any.whl",
  sha256: "c".repeat(64),
  size: 126614513,
} as const;
test("a wheel download tries pythonhosted, the mirror, github, then the relay", () => {
  assert.deepEqual(downloadUrls(WHEEL_RELEASE), [
    WHEEL_RELEASE.url,
    "https://pypi.tuna.tsinghua.edu.cn/packages/46/fe/68a1/sudachidict_core-20260723-py3-none-any.whl",
    "https://github.com/WorksApplications/SudachiDict/releases/download/v20260723/sudachidict_core-20260723-py3-none-any.whl",
    "https://gh-proxy.org/https://github.com/WorksApplications/SudachiDict/releases/download/v20260723/sudachidict_core-20260723-py3-none-any.whl",
  ]);
});

// The relay is a third party. Every other leg is the publisher or a mirror the
// publisher's index points at, so the relay is asked only once they have all
// refused. Its position is not a preference, it is the whole basis for
// including it at all.
test("the third-party relay is last in every list", () => {
  for (const release of [WHEEL_RELEASE, FULL_RELEASE, { ...WHEEL_RELEASE, version: "20261115" }]) {
    const urls = downloadUrls(release);
    const relay = urls.findIndex((u) => u.startsWith("https://gh-proxy.org/"));
    assert.equal(relay, urls.length - 1, release.edition + " " + release.version);
    assert.equal(urls.filter((u) => u.startsWith("https://gh-proxy.org/")).length, 1);
  }
});

// full is absent from PyPI (126 MB against a 100 MiB per-file cap), so every
// PyPI mirror inherits that absence. Two legs, not four, and no mirror leg.
test("full has no pypi mirror to fall back to", () => {
  const urls = downloadUrls(FULL_RELEASE);
  assert.equal(urls.length, 2);
  assert.ok(!urls.some((u) => u.includes("tsinghua")));
  assert.ok(urls[0]!.startsWith("https://github.com/"));
});

// The github url is already the release url for full, so listing it again would
// have the same host tried twice before anything else was tried once.
test("github is not repeated when it is already the release url", () => {
  assert.equal(
    downloadUrls(FULL_RELEASE).filter((u) => u.startsWith("https://github.com/")).length,
    1,
  );
});
