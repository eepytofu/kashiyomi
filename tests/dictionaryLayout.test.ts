import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  DICTIONARY_FILE,
  archiveFileName,
  archivePath,
  dictionaryPath,
  hasDictionary,
} from "../src/engine/dictionaryLayout.ts";

// The bug this module exists for: the boot path hardcoded one file name while
// downloads wrote another, so an install succeeded and then loaded nothing after
// a restart. One constant is what stops the two disagreeing again.
test("the boot path and the download target are the same file", () => {
  assert.equal(dictionaryPath("C:/data/kashiyomi"), `C:/data/kashiyomi/${DICTIONARY_FILE}`);
});

test("a trailing slash on the directory does not double up", () => {
  assert.equal(dictionaryPath("C:/data/"), "C:/data/system_core.dic");
  assert.equal(dictionaryPath("C:\\data\\"), "C:\\data/system_core.dic");
});

// readDir returns full paths in some BetterNCM builds and bare names in others,
// so a caller normalising first would be another copy of this convention.
test("a full path and a bare name both count as installed", () => {
  assert.ok(hasDictionary(["C:/data/kashiyomi/system_core.dic"]));
  assert.ok(hasDictionary(["C:\\data\\kashiyomi\\system_core.dic"]));
  assert.ok(hasDictionary(["system_core.dic"]));
});

test("an empty directory holds no dictionary", () => {
  assert.equal(hasDictionary([]), false);
});

// A staged download is not a dictionary. Counting one as installed would have
// the plugin try to open a partial file, and skip the download that would fix it.
test("a half-finished download is not an installed dictionary", () => {
  assert.equal(
    hasDictionary(["system_core.dic.part", "sudachidict_core-20260723.whl.part"]),
    false,
  );
});

test("unrelated files in the directory are not the dictionary", () => {
  assert.equal(hasDictionary(["kashiyomi.log", "system_tiny.dic", ""]), false);
});

// The staging suffix is what the startup sweeper matches on. Archives were
// written as plain `.whl`, so a killed download stranded ~69 MB that nothing
// collected — losing this suffix silently brings that back.
test("a staged archive is sweepable", () => {
  assert.ok(archiveFileName("20260723").endsWith(".part"));
  assert.ok(archivePath("C:/data", "20260723").endsWith(".part"));
});

test("a staged archive names its version", () => {
  assert.equal(archiveFileName("20260723"), "sudachidict_core-20260723.whl.part");
  assert.equal(archivePath("C:/data", "20260723"), "C:/data/sudachidict_core-20260723.whl.part");
});
