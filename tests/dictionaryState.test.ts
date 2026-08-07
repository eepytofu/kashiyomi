import { strict as assert } from "node:assert";
import { test } from "node:test";
import { migrateDictionarySettings } from "../src/engine/dictionaryState.ts";

// Not a migration, and there are no legacy-shape tests here on purpose: nothing
// is released, so nothing needs backward compatibility (hard rule 10). What is
// covered is the property that does matter — settings live in a JSON blob a
// human can open and edit, and this runs on every read, so no value in it may
// stop the plugin loading.

test("a fresh install gets the defaults", () => {
  assert.deepEqual(migrateDictionarySettings({}), {
    dictVersion: undefined,
    dictSetupSeen: "",
  });
});

test("a recorded version is read back", () => {
  assert.equal(
    migrateDictionarySettings({ dictVersion: "20260723" }).dictVersion,
    "20260723",
  );
});

test("a setup answer is read back", () => {
  assert.equal(migrateDictionarySettings({ dictSetupSeen: "never" }).dictSetupSeen, "never");
});

test("junk falls back to the defaults instead of throwing", () => {
  for (const junk of [null, undefined, 0, "", "nonsense", [], true]) {
    assert.deepEqual(
      migrateDictionarySettings(junk),
      { dictVersion: undefined, dictSetupSeen: "" },
      JSON.stringify(junk),
    );
  }
});

// A version describes a file. Storing a non-string would let the row format
// something that is not a release date, and an empty one would read as a
// version that exists while saying nothing.
test("a version that is not a non-empty string is not stored", () => {
  for (const bad of [42, null, {}, [], true, ""]) {
    assert.equal(
      migrateDictionarySettings({ dictVersion: bad }).dictVersion,
      undefined,
      JSON.stringify(bad),
    );
  }
});

test("an unknown setup answer falls back to unanswered", () => {
  assert.equal(migrateDictionarySettings({ dictSetupSeen: "maybe" }).dictSetupSeen, "");
  assert.equal(migrateDictionarySettings({ dictSetupSeen: 7 }).dictSetupSeen, "");
});

// "" is a real answer meaning not asked yet, and it is what raises the first-run
// dialog. Falling back to it is correct; treating it as invalid would not be.
test("the unanswered state survives a round trip", () => {
  assert.equal(migrateDictionarySettings({ dictSetupSeen: "" }).dictSetupSeen, "");
});

test("every answer the dialog can write is accepted", () => {
  for (const seen of ["later", "never", "done"] as const) {
    assert.equal(migrateDictionarySettings({ dictSetupSeen: seen }).dictSetupSeen, seen);
  }
});

// Extra keys are what a hand-edited blob and an older build both leave behind.
// Reading around them is the whole tolerance this function provides.
test("unknown keys are ignored rather than carried", () => {
  const settings = migrateDictionarySettings({
    dictVersion: "20260723",
    dictPreferredEdition: "full",
    dictVersions: { core: "20260101" },
  });
  assert.deepEqual(settings, { dictVersion: "20260723", dictSetupSeen: "" });
});
