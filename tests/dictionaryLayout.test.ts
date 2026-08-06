import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  archiveFileName,
  archivePath,
  chooseBootEdition,
  dictionaryFileName,
  dictionaryPath,
  editionFromFileName,
  installedEditionsFrom,
} from "../src/engine/dictionaryLayout.ts";

test("a dictionary file name carries its edition", () => {
  assert.equal(dictionaryFileName("core"), "system_core.dic");
  assert.equal(dictionaryFileName("small"), "system_small.dic");
});

// The bug this module exists for: the boot path hardcoded system_core.dic while
// downloads wrote system_<edition>.dic, so `small` installed fine and then
// loaded nothing after a restart. If these two ever disagree again, the plugin
// opens a file that is not there.
test("the boot path and the download target are the same file", () => {
  for (const edition of ["core", "small"] as const) {
    assert.equal(
      dictionaryPath("C:/data/kashiyomi", edition),
      `C:/data/kashiyomi/${dictionaryFileName(edition)}`,
    );
  }
});

test("a trailing slash on the directory does not double up", () => {
  assert.equal(dictionaryPath("C:/data/", "core"), "C:/data/system_core.dic");
  assert.equal(dictionaryPath("C:\\data\\", "core"), "C:\\data/system_core.dic");
});

test("an edition round-trips through its file name", () => {
  for (const edition of ["core", "small"] as const) {
    assert.equal(editionFromFileName(dictionaryFileName(edition)), edition);
  }
});

// readDir returns full paths in some BetterNCM builds and bare names in others,
// so a caller normalising first would be another copy of this convention.
test("a full path and a bare name give the same edition", () => {
  assert.equal(editionFromFileName("C:/data/kashiyomi/system_core.dic"), "core");
  assert.equal(editionFromFileName("C:\\data\\kashiyomi\\system_core.dic"), "core");
  assert.equal(editionFromFileName("system_core.dic"), "core");
});

test("files that are not ours have no edition", () => {
  for (const name of [
    "system_core.dic.part",
    "sudachidict_core-20260723.whl.part",
    "system_full.dic",
    "kashiyomi.log",
    "",
  ]) {
    assert.equal(editionFromFileName(name), undefined, name);
  }
});

// The staging suffix is what the startup sweeper matches on. Archives were
// written as plain `.whl`, so a killed download stranded ~69 MB that nothing
// collected — losing this suffix silently brings that back.
test("a staged archive is sweepable", () => {
  assert.ok(archiveFileName("core", "20260723").endsWith(".part"));
  assert.ok(archivePath("C:/data", "core", "20260723").endsWith(".part"));
});

test("a staged archive names its edition and version", () => {
  assert.equal(archiveFileName("core", "20260723"), "sudachidict_core-20260723.whl.part");
  assert.equal(archiveFileName("small", "20260428"), "sudachidict_small-20260428.whl.part");
});

test("the directory listing decides what is installed", () => {
  assert.deepEqual(installedEditionsFrom([]), []);
  assert.deepEqual(installedEditionsFrom(["system_core.dic"]), ["core"]);
  assert.deepEqual(
    installedEditionsFrom(["system_small.dic", "system_core.dic"]),
    ["core", "small"],
    "returned in edition order, not directory order",
  );
});

test("a half-finished download is not an installed dictionary", () => {
  assert.deepEqual(
    installedEditionsFrom(["system_core.dic.part", "sudachidict_core-20260723.whl.part"]),
    [],
  );
});

test("the preferred edition is loaded when it is present", () => {
  assert.deepEqual(chooseBootEdition("core", ["core"]), { load: "core", deletable: [] });
});

test("the other edition is deletable once the preferred one is there", () => {
  assert.deepEqual(chooseBootEdition("core", ["core", "small"]), {
    load: "core",
    deletable: ["small"],
  });
});

// The regression this prevents: reconciling the two by rewriting settings turned
// "I want core, and the download failed" into "I want small" — the user's choice
// silently overwritten by an accident.
test("booting on the wrong edition never rewrites the preference", () => {
  const choice = chooseBootEdition("core", ["small"]);
  assert.equal(choice.load, "small", "load what exists so the plugin still works");
  assert.deepEqual(choice.deletable, [], "never delete the only dictionary present");
});

test("nothing on disk means nothing to load", () => {
  assert.deepEqual(chooseBootEdition("core", []), { load: undefined, deletable: [] });
});
