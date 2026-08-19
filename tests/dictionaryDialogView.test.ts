import assert from "node:assert/strict";
import test from "node:test";

import type { DictionarySnapshot } from "../src/engine/dictionaryState.ts";
import { dictionaryDialogView, dictionaryEditionAction } from "../src/host/setup/viewState.ts";

const EMPTY: DictionarySnapshot = {
  configured: true,
  installed: [],
  analyzer: { state: "uninitialized" },
};

const DUAL: DictionarySnapshot = {
  configured: true,
  active: "core",
  installed: [
    { edition: "core", version: "20260723", dictionaryBytes: 10, active: true, pinnedVersion: "20260723", updateAvailable: false },
    { edition: "full", version: "20260723", dictionaryBytes: 20, active: false, pinnedVersion: "20260723", updateAvailable: false },
  ],
  analyzer: { state: "ready" },
};

test("first-run offers an absent or outdated selection but not the active current pin", () => {
  assert.deepEqual(dictionaryDialogView(EMPTY, { firstRun: true, selected: "core" }), {
    kind: "first-run", canInstallSelected: true,
  });
  assert.deepEqual(dictionaryDialogView(DUAL, { firstRun: true, selected: "core" }), {
    kind: "first-run", canInstallSelected: false,
  });
  const outdated: DictionarySnapshot = {
    ...DUAL,
    installed: DUAL.installed.map((entry) => entry.edition === "full" ? { ...entry, updateAvailable: true } : entry),
  };
  assert.deepEqual(dictionaryDialogView(outdated, { firstRun: true, selected: "full" }), {
    kind: "first-run", canInstallSelected: true,
  });
});

test("management, progress, cancellation, and typed failure are distinct views", () => {
  assert.deepEqual(dictionaryDialogView(DUAL, { firstRun: false, selected: "core" }), { kind: "manage" });
  const progress: DictionarySnapshot = {
    ...DUAL,
    operation: { id: 4, kind: "install", edition: "full", state: "running", phase: "extracting", done: 5, total: 10, cancellable: true },
  };
  assert.equal(dictionaryDialogView(progress, { firstRun: false, selected: "core" }).kind, "progress");
  const cancelled: DictionarySnapshot = {
    ...DUAL,
    operation: { id: 5, kind: "install", edition: "full", state: "cancelled", phase: "downloading", done: 5, total: 10, cancellable: false },
  };
  assert.deepEqual(dictionaryDialogView(cancelled, { firstRun: false, selected: "core" }), { kind: "cancelled" });
  const failed: DictionarySnapshot = {
    ...DUAL,
    operation: { id: 6, kind: "remove", edition: "core", state: "failed", phase: "cleaning", done: 0, total: 0, cancellable: false, errorCode: "deleteFailed" },
  };
  assert.deepEqual(dictionaryDialogView(failed, { firstRun: false, selected: "core" }), {
    kind: "failure", errorCode: "deleteFailed",
  });
});

test("removal view reports fallback or last-dictionary consequence", () => {
  assert.deepEqual(dictionaryDialogView(DUAL, { firstRun: false, selected: "core", confirmRemove: "core" }), {
    kind: "remove", edition: "core", fallback: "full", stopsAnnotation: false,
  });
  assert.deepEqual(dictionaryDialogView(DUAL, { firstRun: false, selected: "core", confirmRemove: "full" }), {
    kind: "remove", edition: "full", fallback: undefined, stopsAnnotation: false,
  });
  const last: DictionarySnapshot = { ...DUAL, installed: [DUAL.installed[0]!], active: "core" };
  assert.deepEqual(dictionaryDialogView(last, { firstRun: false, selected: "core", confirmRemove: "core" }), {
    kind: "remove", edition: "core", fallback: undefined, stopsAnnotation: true,
  });
});

test("management action matrix distinguishes install, use, update, and update-and-use", () => {
  assert.equal(dictionaryEditionAction(EMPTY, "core"), "install-use");
  assert.equal(dictionaryEditionAction(DUAL, "core"), undefined);
  assert.equal(dictionaryEditionAction(DUAL, "full"), "use");

  const activeOutdated: DictionarySnapshot = {
    ...DUAL,
    installed: DUAL.installed.map((entry) => entry.edition === "core" ? { ...entry, updateAvailable: true } : entry),
  };
  assert.equal(dictionaryEditionAction(activeOutdated, "core"), "update");

  const inactiveOutdated: DictionarySnapshot = {
    ...DUAL,
    installed: DUAL.installed.map((entry) => entry.edition === "full" ? { ...entry, updateAvailable: true } : entry),
  };
  assert.equal(dictionaryEditionAction(inactiveOutdated, "full"), "update-use");
});
