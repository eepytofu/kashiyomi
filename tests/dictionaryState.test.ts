import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  migrateDictionarySettings,
  pruneVersions,
  switchPending,
  withVersion,
  type DictionaryInventory,
} from "../src/engine/dictionaryState.ts";

const inventory = (
  installed: readonly ("full" | "core" | "small")[],
  loaded?: "full" | "core" | "small",
): DictionaryInventory => ({ installed, versions: {}, loaded });

test("a fresh install gets the defaults", () => {
  const settings = migrateDictionarySettings({});
  assert.equal(settings.dictPreferredEdition, "core");
  assert.deepEqual(settings.dictVersions, {});
  assert.equal(settings.dictSetupSeen, "");
});

// The legacy shape is the one every existing install is holding right now:
// one edition field doubling as installed-and-wanted, plus a single version
// string. Losing either costs a 69 MB re-download to learn a date already on
// the disk.
test("the legacy edition and version carry over", () => {
  const settings = migrateDictionarySettings({ dictEdition: "small", dictVersion: "20260723" });
  assert.equal(settings.dictPreferredEdition, "small");
  assert.deepEqual(settings.dictVersions, { small: "20260723" });
});

test("a legacy version with no edition is dropped rather than guessed", () => {
  assert.deepEqual(migrateDictionarySettings({ dictVersion: "20260723" }).dictVersions, {});
});

test("an empty legacy version does not become an entry", () => {
  assert.deepEqual(
    migrateDictionarySettings({ dictEdition: "core", dictVersion: "" }).dictVersions,
    {},
  );
});

test("the new preference wins over the legacy field", () => {
  const settings = migrateDictionarySettings({
    dictPreferredEdition: "full",
    dictEdition: "small",
  });
  assert.equal(settings.dictPreferredEdition, "full");
});

// Once dictVersions exists it is the record, and the legacy string beside it is
// a leftover. Merging the two would resurrect a version for an edition the user
// has since deleted.
test("dictVersions replaces the legacy string, it does not merge with it", () => {
  const settings = migrateDictionarySettings({
    dictEdition: "small",
    dictVersion: "20260101",
    dictVersions: { core: "20260723" },
  });
  assert.deepEqual(settings.dictVersions, { core: "20260723" });
});

// This runs on every settings read, so a blob edited by hand must not be able
// to stop the plugin loading.
test("junk falls back to the default instead of throwing", () => {
  for (const raw of [null, undefined, 42, "core", [], { dictEdition: "medium" }]) {
    const settings = migrateDictionarySettings(raw);
    assert.equal(settings.dictPreferredEdition, "core");
    assert.deepEqual(settings.dictVersions, {});
    assert.equal(settings.dictSetupSeen, "");
  }
});

test("a non-string version is not stored", () => {
  assert.deepEqual(
    migrateDictionarySettings({ dictVersions: { core: 20260723, small: "20260101" } }).dictVersions,
    { small: "20260101" },
  );
});

test("an unknown setup answer falls back to unanswered", () => {
  assert.equal(migrateDictionarySettings({ dictSetupSeen: "maybe" }).dictSetupSeen, "");
  assert.equal(migrateDictionarySettings({ dictSetupSeen: "later" }).dictSetupSeen, "later");
});

// A version describes a file. Keeping one for a file the user deleted by hand
// lets the row claim a release for something nothing can open.
test("versions for editions not on disk are pruned", () => {
  assert.deepEqual(
    pruneVersions({ core: "20260723", small: "20260101" }, ["core"]),
    { core: "20260723" },
  );
});

test("pruning to nothing gives an empty record, not the input", () => {
  assert.deepEqual(pruneVersions({ core: "20260723" }, []), {});
});

test("recording a release leaves the other editions alone", () => {
  assert.deepEqual(withVersion({ small: "20260101" }, "core", "20260723"), {
    core: "20260723",
    small: "20260101",
  });
});

test("recording the same edition twice overwrites rather than duplicates", () => {
  assert.deepEqual(withVersion({ core: "20260101" }, "core", "20260723"), { core: "20260723" });
});

// The preference and the disk are allowed to disagree, because boot used to
// resolve the disagreement by overwriting the preference. The row has to be
// able to see it.
test("a preference the disk does not satisfy is a pending switch", () => {
  assert.equal(switchPending("full", inventory(["core"], "core")), true);
  assert.equal(switchPending("core", inventory(["core"], "core")), false);
});

test("nothing installed is not a pending switch", () => {
  assert.equal(switchPending("core", inventory([])), false);
});

test("the preference being present is enough, whatever else is", () => {
  assert.equal(switchPending("core", inventory(["core", "small"], "core")), false);
});
