import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  DICTIONARY_COOLDOWN_MS,
  dictionaryRowState,
  type RowInput,
  type RowView,
} from "../src/engine/dictionaryRowState.ts";
import { pinnedRelease } from "../src/engine/dictionaryPins.ts";
import { requiredFreeBytes } from "../src/engine/dictionarySource.ts";
import type { DictionaryJob } from "../src/engine/dictionaryState.ts";

const NOW = 1_000_000;
const ROOMY = requiredFreeBytes(pinnedRelease().size) * 2;

function view(over: Partial<RowInput> = {}): RowView {
  return dictionaryRowState({
    inventory: { installed: false, loaded: false, version: undefined, latest: undefined },
    job: { kind: "idle" },
    now: NOW,
    freeBytes: ROOMY,
    ...over,
  });
}

const installed = (version?: string, latest?: string): RowInput["inventory"] => ({
  installed: true,
  loaded: true,
  version,
  latest,
});

const job = (over: DictionaryJob): DictionaryJob => over;

test("nothing installed offers to install it at the pinned release", () => {
  const v = view();
  assert.equal(v.primary.action.kind, "install");
  assert.equal(v.primary.disabled, false);
  assert.equal(v.message.kind, "absent");
  assert.equal(v.dot, "bad");
  assert.equal(v.cancel.shown, false);
  assert.equal(v.settling, false);
  if (v.message.kind === "absent") assert.equal(v.message.version, pinnedRelease().version);
});

// The eager check is the point: "this machine cannot fit it" has to be a state
// you can see before pressing, not a failure you earn by pressing.
test("a disk that cannot fit it disables the button rather than offering a dead press", () => {
  const v = view({ freeBytes: 1024 });
  assert.equal(v.message.kind, "noSpace");
  assert.equal(v.primary.disabled, true, "pressing it could only fail");
  assert.equal(v.dot, "bad");
});

// D17: the requirement is the archive plus its extraction, not the download.
// The row used to print the download size next to "not enough space".
test("the space warning quotes the free space needed, not the download size", () => {
  const v = view({ freeBytes: 1024 });
  assert.equal(v.message.kind, "noSpace");
  if (v.message.kind !== "noSpace") return;
  assert.equal(v.message.needed, requiredFreeBytes(pinnedRelease().size));
  assert.ok(v.message.needed > pinnedRelease().size * 3);
});

// The disk could not be asked, which is not the same as it being full. Refusing
// the install there would block it on a machine with plenty of room.
test("an unknown free space is not treated as no space", () => {
  const v = view({ freeBytes: undefined });
  assert.equal(v.message.kind, "absent");
  assert.equal(v.primary.disabled, false);
});

test("an installed dictionary offers an update", () => {
  const v = view({ inventory: installed("20260723") });
  assert.equal(v.primary.action.kind, "update");
  assert.equal(v.primary.disabled, false);
  assert.equal(v.dot, "ready");
  assert.equal(v.message.kind, "installed");
  if (v.message.kind === "installed") assert.equal(v.message.version, "20260723");
});

// A dictionary placed by `npm run fetch-dict` has no recorded version. Unknown
// is not outdated, and it is not absent either.
test("an installed dictionary with no recorded version still reads as installed", () => {
  const v = view({ inventory: installed(undefined) });
  assert.equal(v.message.kind, "installed");
  assert.equal(v.primary.action.kind, "update");
  if (v.message.kind === "installed") {
    assert.equal(v.message.version, undefined);
    assert.equal(v.message.updateAvailable, false, "unknown must never read as behind");
  }
});

// No space to install into is still no space to update into, so the check does
// not stop applying once something is on disk.
test("an installed dictionary is not blocked by the space check", () => {
  const v = view({ inventory: installed("20260723"), freeBytes: 1024 });
  assert.equal(v.message.kind, "installed", "the eager check is about installing, not updating");
  assert.equal(v.primary.action.kind, "update");
});

test("resolving says what it is doing and can be cancelled", () => {
  const v = view({ job: job({ kind: "resolving" }) });
  assert.equal(v.message.kind, "checking");
  assert.equal(v.primary.disabled, true);
  assert.equal(v.dot, "loading");
  assert.equal(v.cancel.shown, true);
  assert.equal(v.cancel.disabled, false, "a stalling source is when cancel is reached for");
  assert.equal(v.settling, true);
});

test("downloading carries progress and the one cancel that always works", () => {
  const v = view({ job: job({ kind: "downloading", received: 100, total: 1000 }) });
  assert.equal(v.message.kind, "downloading");
  if (v.message.kind === "downloading") {
    assert.equal(v.message.received, 100);
    assert.equal(v.message.total, 1000);
  }
  assert.equal(v.cancel.shown, true);
  assert.equal(v.cancel.disabled, false);
  assert.equal(v.settling, true);
});

// The two phases that are long, measurable and safe to abandon: nothing has
// touched the live path yet.
test("verifying and unpacking carry their own progress and can be cancelled", () => {
  for (const phase of ["verifying", "extracting"] as const) {
    const v = view({ job: job({ kind: "installing", phase, done: 5, total: 10 }) });
    assert.equal(v.message.kind, "installing", phase);
    assert.equal(v.cancel.shown, true, phase);
    assert.equal(v.cancel.disabled, false, phase);
    if (v.message.kind === "installing") {
      assert.equal(v.message.phase, phase);
      assert.equal(v.message.done, 5);
    }
  }
});

// Past the swap the old dictionary is already unloaded and the rename may have
// landed, so there is nothing safe to stop. The button stays visible because one
// that vanishes at that moment reads as a bug, where a disabled one reads as
// "not now".
test("the swap and the load show cancel disabled rather than removing it", () => {
  for (const phase of ["swapping", "loading"] as const) {
    const v = view({ job: job({ kind: "installing", phase, done: 0, total: 0 }) });
    assert.equal(v.cancel.shown, true, phase);
    assert.equal(v.cancel.disabled, true, phase);
  }
});

// D14: the label used to stay "Update" for the whole install, so the row read as
// though nothing had happened yet.
test("the button never keeps its idle label while working", () => {
  const running: DictionaryJob[] = [
    { kind: "resolving" },
    { kind: "downloading", received: 0, total: 10 },
    { kind: "installing", phase: "verifying", done: 0, total: 10 },
    { kind: "installing", phase: "loading", done: 0, total: 0 },
  ];
  for (const j of running) {
    const v = view({ job: j, inventory: installed("20260723") });
    assert.equal(v.primary.action.kind, "working", j.kind);
    assert.equal(v.primary.disabled, true, j.kind);
    assert.equal(v.settling, true, j.kind);
  }
});

test("up to date says so over the installed state, with the button held", () => {
  const v = view({
    inventory: installed("20260723"),
    job: job({ kind: "upToDate", at: NOW }),
  });
  assert.equal(v.message.kind, "installed");
  if (v.message.kind === "installed") assert.equal(v.message.upToDate, true);
  assert.equal(v.primary.disabled, true, "the cooldown is what closes the double-click hole");
  assert.equal(v.settling, true);
});

// A pure function of (job, now), so the panel needs no timer of its own to
// clear it.
test("up to date expires on its own instead of needing a timer", () => {
  const after = view({
    inventory: installed("20260723"),
    job: job({ kind: "upToDate", at: NOW - DICTIONARY_COOLDOWN_MS - 1 }),
  });
  assert.equal(after.message.kind, "installed");
  if (after.message.kind === "installed") assert.equal(after.message.upToDate, false);
  assert.equal(after.primary.disabled, false);
  assert.equal(after.settling, false);
});

// D11: the hole was the button re-enabling ~300 ms into a click, so a second
// press started a concurrent install.
test("a retryable failure offers retry, but not immediately", () => {
  const v = view({ job: job({ kind: "failed", reason: "offline", at: NOW }) });
  assert.equal(v.primary.action.kind, "retry");
  assert.equal(v.primary.disabled, true);
  assert.equal(v.dot, "bad");
});

test("retry becomes pressable once the cooldown elapses", () => {
  const v = view({
    job: job({ kind: "failed", reason: "offline", at: NOW - DICTIONARY_COOLDOWN_MS - 1 }),
  });
  assert.equal(v.primary.action.kind, "retry");
  assert.equal(v.primary.disabled, false);
  assert.equal(v.settling, false);
});

// D18: retrying `no-source` repeats the same two refused requests, so a Retry
// button would be a lie. The user has to change something first.
test("no-source offers the normal action disabled, never a retry", () => {
  const v = view({
    inventory: installed("20260723"),
    job: job({ kind: "failed", reason: "no-source", at: NOW }),
  });
  assert.equal(v.message.kind, "updateCheckFailed");
  assert.notEqual(v.primary.action.kind, "retry");
  assert.equal(v.primary.disabled, true);
});

// One condition, one wording. A disk-space failure reads exactly like the eager
// check that should have caught it first.
test("a disk-space failure gives the same answer as the eager check", () => {
  const failed = view({
    freeBytes: 1024,
    job: job({ kind: "failed", reason: "disk-space", at: NOW }),
  });
  const eager = view({ freeBytes: 1024 });
  assert.equal(failed.message.kind, "noSpace");
  assert.deepEqual(failed.message, eager.message);
  assert.equal(failed.primary.disabled, true);
});

// Cancelling is not a fault, so the row says so once and then offers exactly
// what it offered before the press.
test("cancelling reads as neutral and restores the previous action", () => {
  const v = view({ job: job({ kind: "failed", reason: "cancelled", at: NOW }) });
  assert.equal(v.message.kind, "cancelled");
  assert.equal(v.dot, "neutral", "not an error state");
  assert.equal(v.primary.action.kind, "install");
  assert.equal(v.settling, true);
});

test("a cancelled job stops being mentioned after the cooldown", () => {
  const v = view({
    job: job({ kind: "failed", reason: "cancelled", at: NOW - DICTIONARY_COOLDOWN_MS - 1 }),
  });
  assert.equal(v.message.kind, "absent");
  assert.equal(v.settling, false);
});

// A load failure keeps the file and the version. The disk is the authority on
// what is installed and the analyzer on what is open, so a dictionary the
// analyzer could not load must not read as one that is not there.
test("a dictionary on disk that failed to load still reports as installed", () => {
  const v = view({
    inventory: { installed: true, loaded: false, version: "20260723", latest: undefined },
  });
  assert.equal(v.message.kind, "installed");
  assert.equal(v.primary.action.kind, "update");
  if (v.message.kind === "installed") assert.equal(v.message.version, "20260723");
});

// Unlike `upToDate` and `cancelled`, a failure does not fade: it stays until
// something is done about it. What the cooldown gates is the retry, not the
// report.
test("a failure keeps reporting itself after the cooldown, with retry now live", () => {
  const v = view({
    inventory: { installed: true, loaded: false, version: "20260723", latest: undefined },
    job: job({ kind: "failed", reason: "load", at: NOW - DICTIONARY_COOLDOWN_MS - 1 }),
  });
  assert.equal(v.message.kind, "failed");
  assert.equal(v.primary.action.kind, "retry");
  assert.equal(v.primary.disabled, false);
});

// An available update is a standing fact about the disk, so it must not fade
// with the cooldown that "already the newest release" fades with.
test("an update is offered only when both versions are known and differ", () => {
  const behind = view({ inventory: installed("20260428", "20260723") });
  assert.equal(behind.message.kind, "installed");
  if (behind.message.kind === "installed") assert.equal(behind.message.updateAvailable, true);

  const current = view({ inventory: installed("20260723", "20260723") });
  if (current.message.kind === "installed") {
    assert.equal(current.message.updateAvailable, false, "same version is not an update");
  }

  // Undefined means "not asked", never "up to date" and never "behind".
  const unchecked = view({ inventory: installed("20260428", undefined) });
  if (unchecked.message.kind === "installed") {
    assert.equal(unchecked.message.updateAvailable, false, "no check has been made");
  }
  const unknownLocal = view({ inventory: installed(undefined, "20260723") });
  if (unknownLocal.message.kind === "installed") {
    assert.equal(unknownLocal.message.updateAvailable, false, "nothing to compare against");
  }
});

// The settings row reflects a running job but must not report an outcome it did
// not cause: "already the newest release" on opening settings asserted a check
// that surface had never performed.
test("a surface that does not own the job ignores finished outcomes", () => {
  const inventory = installed("20260723");
  const upToDate = view({ inventory, job: job({ kind: "upToDate", at: NOW }), ownsJob: false });
  assert.equal(upToDate.message.kind, "installed");
  if (upToDate.message.kind === "installed") assert.equal(upToDate.message.upToDate, false);
  assert.equal(upToDate.primary.disabled, false, "no cooldown from a press it did not make");

  const failed = view({
    inventory,
    job: job({ kind: "failed", reason: "offline", at: NOW }),
    ownsJob: false,
  });
  assert.equal(failed.message.kind, "installed", "someone else's failure is not this row's news");
  assert.notEqual(failed.primary.action.kind, "retry");
});

// A running job is a fact about the dictionary, so every surface shows it. Only
// the outcome is owned.
test("a running job is shown even on a surface that does not own it", () => {
  const v = view({
    inventory: installed("20260723"),
    job: job({ kind: "downloading", received: 1, total: 2 }),
    ownsJob: false,
  });
  assert.equal(v.message.kind, "downloading");
  assert.equal(v.primary.action.kind, "working");
  assert.equal(v.settling, true);
});
