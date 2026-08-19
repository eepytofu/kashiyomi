import assert from "node:assert/strict";
import test from "node:test";

import {
  editionViewState,
  fallbackEdition,
  parseDictionarySnapshot,
  type DictionarySnapshot,
} from "../src/engine/dictionaryState.ts";

function native(overrides: Record<string, unknown> = {}): unknown {
  return {
    dictionary: {
      configured: true,
      installed: [],
      active: null,
      freeBytes: 900,
      operation: null,
      ...overrides,
    },
    analyzer: { state: "uninitialized" },
  };
}

test("snapshot validation preserves durable operation phases and never maps idle to success", () => {
  const parsed = parseDictionarySnapshot(native({
    operation: {
      id: 7,
      kind: "install",
      edition: "core",
      state: "running",
      phase: "downloading",
      done: 25,
      total: 100,
      cancellable: true,
      errorCode: null,
    },
  }));
  assert.equal(parsed?.operation?.state, "running");
  assert.equal(parsed?.operation?.phase, "downloading");
  assert.equal(parseDictionarySnapshot(native({ operation: {
    id: 8,
    kind: "install",
    edition: "core",
    state: "idle",
    phase: "starting",
    done: 0,
    total: 0,
    cancellable: false,
    errorCode: null,
  } })), undefined);
});

test("snapshot validation rejects duplicate editions and malformed counters", () => {
  const item = { edition: "core", version: "20260723", dictionaryBytes: 10, active: true, pinnedVersion: "20260723", updateAvailable: false };
  assert.equal(parseDictionarySnapshot(native({ installed: [item, item] })), undefined);
  assert.equal(parseDictionarySnapshot(native({ freeBytes: -1 })), undefined);
});

test("edition states cover first-run, management, update, and dual-install fallback", () => {
  const empty = parseDictionarySnapshot(native())!;
  assert.equal(editionViewState(empty, "core"), "not-installed");
  const snapshot: DictionarySnapshot = {
    configured: true,
    active: "core",
    analyzer: { state: "ready" },
    installed: [
      { edition: "core", version: "20260723", dictionaryBytes: 10, active: true, pinnedVersion: "20260723", updateAvailable: false },
      { edition: "full", version: "legacy", dictionaryBytes: 20, active: false, pinnedVersion: "20260723", updateAvailable: true },
    ],
  };
  assert.equal(editionViewState(snapshot, "core"), "in-use");
  assert.equal(editionViewState(snapshot, "full"), "update-available");
  assert.equal(fallbackEdition(snapshot, "core"), "full");
  const installed = { ...snapshot, active: "full" as const, installed: snapshot.installed.map((item) => ({ ...item, updateAvailable: false })) };
  assert.equal(editionViewState(installed, "core"), "installed");
});

test("typed failure and cancelled snapshots survive validation", () => {
  for (const state of ["failed", "cancelled"] as const) {
    const parsed = parseDictionarySnapshot(native({ operation: {
      id: 9, kind: "remove", edition: "core", state, phase: "cleaning",
      done: 0, total: 0, cancellable: false, errorCode: state === "failed" ? "deleteFailed" : null,
    } }));
    assert.equal(parsed?.operation?.state, state);
  }
});
