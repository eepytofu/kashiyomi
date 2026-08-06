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
  dictionarySupply,
  resolveFullFromPypi,
  vendorArchiveUrl,
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
  assert.equal(sources.length, 2);
  assert.match(sources[0]!, /^https:\/\/pypi\.org\//u);
  assert.match(sources[1]!, /tsinghua/u);
  // Lowercased for the simple index, which is case-normalised per PEP 503.
  assert.match(sources[1]!, /sudachidict-core/u);
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

// --- full: a different supply chain, not a bigger download -------------------

test("the zip member differs between a wheel and the vendor archive", () => {
  assert.equal(
    dictionarySupply("core", "20260723").member,
    "sudachidict_core/resources/system.dic",
  );
  assert.equal(
    dictionarySupply("full", "20260723").member,
    "sudachi-dictionary-20260723/system_full.dic",
  );
});

// full's member embeds the version; extracting it with core's layout, or with a
// stale version, fails with "the archive does not contain ...".
test("the vendor member tracks the version", () => {
  assert.equal(
    dictionarySupply("full", "20260428").member,
    "sudachi-dictionary-20260428/system_full.dic",
  );
});

test("only full is vouched for by a hash we generated ourselves", () => {
  assert.equal(dictionarySupply("full", "20260723").selfPinned, true);
  assert.equal(dictionarySupply("core", "20260723").selfPinned, false);
  assert.equal(dictionarySupply("small", "20260723").selfPinned, false);
});

test("full downloads from the vendor, over https", () => {
  const url = vendorArchiveUrl("full", "20260723");
  assert.equal(
    url,
    "https://d2ej7fkh96fzlu.cloudfront.net/sudachidict/sudachi-dictionary-20260723-full.zip",
  );
  assert.ok(url.startsWith("https://"), "never plaintext");
});

const PINNED_FULL = {
  edition: "full",
  version: "20260723",
  sha256: "f".repeat(64),
  size: 126615116,
} as const;

test("full installs when upstream is still on the pinned version", () => {
  const outcome = resolveFullFromPypi({ info: { version: "20260723" } }, PINNED_FULL);
  assert.equal(outcome.kind, "pinned");
  if (outcome.kind !== "pinned") return;
  assert.equal(outcome.release.sha256, PINNED_FULL.sha256);
  assert.ok(outcome.release.url.includes("20260723"));
});

// The point of the whole self-pinning arrangement: a newer release has no
// digest anyone can vouch for, so it is reported rather than fetched.
test("a newer full release is reported, never downloaded unverified", () => {
  const outcome = resolveFullFromPypi({ info: { version: "20261115" } }, PINNED_FULL);
  assert.equal(outcome.kind, "newer");
  if (outcome.kind !== "newer") return;
  assert.equal(outcome.version, "20261115");
});

test("unusable metadata falls back to the pinned release rather than failing", () => {
  for (const body of [{}, { info: {} }, { info: { version: "" } }, null, "nonsense"]) {
    assert.equal(resolveFullFromPypi(body, PINNED_FULL).kind, "pinned", JSON.stringify(body));
  }
});
