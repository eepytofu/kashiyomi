import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  DICTIONARY_MEMBER,
  downloadUrls,
  isRetryable,
  mayInstall,
  metadataSources,
  mirrorUrl,
  parsePypiRelease,
  parseSimpleIndexRelease,
  requiredFreeBytes,
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
    {
      packagetype: "sdist",
      url: "https://example/sdist.tar.gz",
      size: 4096,
      digests: { sha256: "f".repeat(64) },
    },
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
  const release = parsePypiRelease(PYPI_CORE);
  assert.equal(release?.version, "20260723");
  assert.equal(release?.size, 72275897);
  assert.match(release?.url ?? "", /\.whl$/u);
});

test("an sdist is never accepted as a source", () => {
  // An sdist is a ~9 KB stub that downloads the real archive at install time
  // from a plaintext host with no checksum, so its digest vouches for nothing.
  const sdistOnly = { info: { version: "20260723" }, urls: [PYPI_CORE.urls[1]] };
  assert.equal(parsePypiRelease(sdistOnly), undefined);
});

test("the mirror index picks the newest release, not the last listed", () => {
  const release = parseSimpleIndexRelease(SIMPLE_CORE);
  assert.equal(release?.version, "20260723");
  // Reversing the file order must not change the answer: the index gives no
  // ordering guarantee, so position must not be load-bearing.
  const reversed = { files: [...SIMPLE_CORE.files].reverse() };
  assert.equal(parseSimpleIndexRelease(reversed)?.version, "20260723");
});

// The index lists every package a mirror carries. Matching loosely would let a
// neighbouring SudachiDict package be installed as the dictionary.
test("the mirror index ignores files that are not the core wheel", () => {
  const others = {
    files: [
      { ...SIMPLE_CORE.files[0]!, filename: "sudachidict_small-20260723-py3-none-any.whl" },
      { ...SIMPLE_CORE.files[0]!, filename: "sudachidict_full-20260723-py3-none-any.whl" },
      { ...SIMPLE_CORE.files[0]!, filename: "sudachidict_core-20260723.tar.gz" },
    ],
  };
  assert.equal(parseSimpleIndexRelease(others), undefined);
});

test("a release missing anything needed to verify it is rejected", () => {
  const base = PYPI_CORE.urls[0]!;
  const missing = (patch: Record<string, unknown>) =>
    parsePypiRelease({ info: { version: "20260723" }, urls: [{ ...base, ...patch }] });
  assert.equal(missing({ digests: {} }), undefined, "no hash");
  assert.equal(missing({ digests: { sha256: "not-hex" } }), undefined, "malformed hash");
  assert.equal(missing({ size: 0 }), undefined, "zero size");
  assert.equal(missing({ url: "" }), undefined, "no url");
});

test("garbage responses do not throw", () => {
  // Every one of these is a real possibility when a captive portal or a proxy
  // answers instead of the registry.
  for (const body of [undefined, null, "", 42, [], {}, { files: "nope" }, { urls: {} }]) {
    assert.equal(parsePypiRelease(body), undefined);
    assert.equal(parseSimpleIndexRelease(body), undefined);
  }
});

test("sources are ordered by preference, with the mirror second", () => {
  const sources = metadataSources();
  assert.deepEqual(
    sources.map((s) => s.kind),
    ["pypi", "simple"],
  );
  assert.match(sources[0]!.url, /^https:\/\/pypi\.org\//u);
  assert.match(sources[1]!.url, /tsinghua/u);
  // Lowercased for the simple index, which is case-normalised per PEP 503.
  assert.match(sources[1]!.url, /sudachidict-core/u);
});

// Every source is the publisher or an official mirror of the publisher's own
// index. The third-party relay that once carried `full` is gone with it, and
// nothing here may reintroduce a host outside that set.
test("no source is a third party", () => {
  for (const source of metadataSources()) {
    assert.match(source.url, /^https:\/\/(pypi\.org|pypi\.tuna\.tsinghua\.edu\.cn)\//u, source.url);
  }
});

test("free space is checked for archive plus extraction, not just the download", () => {
  // core: 68.9 MB archive, 207.4 MB extracted, and both exist at once.
  const archive = 72275897;
  const needed = requiredFreeBytes(archive);
  assert.ok(needed > archive * 4, "must cover the extracted copy as well");
  assert.ok(needed < archive * 5, "but not demand an absurd amount");
});

test("a checksum mismatch can never be installed", () => {
  const release: DictionaryRelease = {
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
  for (const reason of [
    "offline",
    "checksum",
    "disk-space",
    "extract",
    "load",
    "cancelled",
  ] as const) {
    assert.equal(isRetryable(reason), true, reason);
  }
});

// A wheel is a ZIP, so the native extractor treats it like any archive and only
// the member path is specific to the packaging.
test("the dictionary sits at a known path inside the wheel", () => {
  assert.equal(DICTIONARY_MEMBER, "sudachidict_core/resources/system.dic");
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

const WHEEL_RELEASE: DictionaryRelease = {
  version: "20260723",
  url: "https://files.pythonhosted.org/packages/46/fe/68a1/sudachidict_core-20260723-py3-none-any.whl",
  sha256: "b".repeat(64),
  size: 72275897,
};

test("a wheel download tries pythonhosted, then the mirror", () => {
  assert.deepEqual(downloadUrls(WHEEL_RELEASE), [
    WHEEL_RELEASE.url,
    "https://pypi.tuna.tsinghua.edu.cn/packages/46/fe/68a1/sudachidict_core-20260723-py3-none-any.whl",
  ]);
});

// Falling through on failure rather than on a guess about where the user is:
// the mainland reaches the mirror naturally and everyone else never learns it
// exists, so the publisher must stay first.
test("the publisher is always tried before the mirror", () => {
  for (const version of ["20260723", "20261115"]) {
    const urls = downloadUrls({ ...WHEEL_RELEASE, version });
    assert.ok(urls[0]!.startsWith("https://files.pythonhosted.org/"), version);
    assert.ok(urls[1]!.includes("tsinghua"), version);
  }
});

// A pinned release whose url the swap does not recognise still has to be
// installable from where it came from, rather than yielding an empty list.
test("a url with no mirror still yields one place to download from", () => {
  const urls = downloadUrls({ ...WHEEL_RELEASE, url: "https://example.invalid/x.whl" });
  assert.deepEqual(urls, ["https://example.invalid/x.whl"]);
});
