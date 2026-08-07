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
    dictSetupAnswered: false,
    dictCheckedAt: undefined,
  });
});

test("a recorded version is read back", () => {
  assert.equal(
    migrateDictionarySettings({ dictVersion: "20260723" }).dictVersion,
    "20260723",
  );
});

test("a setup answer is read back", () => {
  assert.equal(migrateDictionarySettings({ dictSetupAnswered: true }).dictSetupAnswered, true);
});

test("junk falls back to the defaults instead of throwing", () => {
  for (const junk of [null, undefined, 0, "", "nonsense", [], true]) {
    assert.deepEqual(
      migrateDictionarySettings(junk),
      { dictVersion: undefined, dictSetupAnswered: false, dictCheckedAt: undefined },
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

// Only a literal `true` counts as answered. Anything else has to mean "not
// asked yet", because the failure that matters is a new install being silently
// treated as one that already declined, and never seeing the prompt at all.
test("anything but true reads as unanswered", () => {
  for (const bad of ["maybe", 7, "true", 1, {}, [], null, "later", "never"]) {
    assert.equal(
      migrateDictionarySettings({ dictSetupAnswered: bad }).dictSetupAnswered,
      false,
      JSON.stringify(bad),
    );
  }
});

// Unanswered is what raises the first-run dialog, so an absent key must land
// there rather than being treated as invalid input.
test("a missing answer is unanswered, which is what raises the dialog", () => {
  assert.equal(migrateDictionarySettings({}).dictSetupAnswered, false);
});

// Extra keys are what a hand-edited blob and an older build both leave behind.
// Reading around them is the whole tolerance this function provides.
test("unknown keys are ignored rather than carried", () => {
  const settings = migrateDictionarySettings({
    dictVersion: "20260723",
    dictPreferredEdition: "full",
    dictVersions: { core: "20260101" },
  });
  assert.deepEqual(settings, {
    dictVersion: "20260723",
    dictSetupAnswered: false,
    dictCheckedAt: undefined,
  });
});

// The check timestamp gates a twelve-hour throttle, so a value that is not a
// usable number has to become "never checked". NaN and Infinity both pass a
// bare `typeof` test and would make every comparison against the interval
// false, silently disabling the throttle they were read for.
test("a check timestamp that is not a usable number is not stored", () => {
  for (const bad of ["20260723", null, {}, [], true, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(
      migrateDictionarySettings({ dictCheckedAt: bad }).dictCheckedAt,
      undefined,
      String(bad),
    );
  }
});

test("a real check timestamp is read back", () => {
  assert.equal(migrateDictionarySettings({ dictCheckedAt: 1786110647239 }).dictCheckedAt, 1786110647239);
});
