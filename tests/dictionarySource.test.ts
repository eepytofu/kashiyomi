import assert from "node:assert/strict";
import test from "node:test";

import {
  DICTIONARY_RELEASES,
  parseReleaseManifest,
  pinnedRelease,
  requiredFreeBytes,
} from "../src/engine/dictionarySource.ts";

test("canonical pins embed the reviewed source order", () => {
  assert.equal(DICTIONARY_RELEASES.schemaVersion, 1);
  assert.match(pinnedRelease("core").sources[0]!.url, /cloudfront\.net/u);
  assert.match(pinnedRelease("core").sources[1]!.url, /tsinghua/u);
  assert.match(pinnedRelease("core").sources[2]!.url, /pythonhosted/u);
  assert.match(pinnedRelease("full").sources[0]!.url, /cloudfront\.net/u);
  assert.match(pinnedRelease("full").sources[1]!.url, /github\.com/u);
});

test("free-space requirement covers the largest archive, dictionary, and margin", () => {
  const release = pinnedRelease("full");
  const archive = Math.max(...release.sources.map((source) => source.archiveBytes));
  assert.equal(requiredFreeBytes("full"), archive + release.dictionaryBytes + 64 * 1024 * 1024);
});

test("manifest parser rejects incomplete verification metadata", () => {
  const invalid = structuredClone(DICTIONARY_RELEASES) as unknown as {
    editions: { core: { dictionarySha256: string } };
  };
  invalid.editions.core.dictionarySha256 = "unchecked";
  assert.equal(parseReleaseManifest(invalid), undefined);

  const downgraded = structuredClone(DICTIONARY_RELEASES) as unknown as {
    editions: { core: { sources: Array<{ url: string }> } };
  };
  downgraded.editions.core.sources[0]!.url = "http://downloads.example.invalid/core.zip";
  assert.equal(parseReleaseManifest(downgraded), undefined);
});
