import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  DICTIONARY_COOLDOWN_MS,
  dictionaryRowState,
  type RowInput,
  type RowView,
} from "../src/engine/dictionaryRowState.ts";
import { pinnedRelease } from "../src/engine/dictionaryPins.ts";
import { requiredFreeBytes, type DictionaryEdition } from "../src/engine/dictionarySource.ts";
import type { DictionaryJob, DictionaryVersions } from "../src/engine/dictionaryState.ts";

const NOW = 1_000_000;
const ROOMY = requiredFreeBytes(pinnedRelease("full").size) * 2;

function view(over: Partial<RowInput> = {}): RowView {
  return dictionaryRowState({
    preferred: "core",
    inventory: { installed: [], versions: {}, loaded: undefined },
    job: { kind: "idle" },
    now: NOW,
    freeBytes: ROOMY,
    ...over,
  });
}

const installed = (
  editions: readonly DictionaryEdition[],
  versions: DictionaryVersions = {},
): RowInput["inventory"] => ({ installed: editions, versions, loaded: editions[0] });

const job = (over: DictionaryJob): DictionaryJob => over;

// S1
test("nothing installed offers the selection at its pinned release", () => {
  const v = view();
  assert.deepEqual(v.message, {
    kind: "absent",
    edition: "core",
    version: pinnedRelease("core").version,
  });
  assert.deepEqual(v.primary, { action: { kind: "install" }, disabled: false });
  assert.equal(v.dot, "bad");
  assert.equal(v.pickerEnabled, true);
});

// S2. The eager check is the point: "this machine cannot fit it" has to be a
// state you can see before pressing, not a failure you earn by pressing.
test("a selection that does not fit offers the largest one that does", () => {
  const tight = requiredFreeBytes(pinnedRelease("small").size) + 1;
  const v = view({ preferred: "full", freeBytes: tight });
  assert.equal(v.message.kind, "spaceForOther");
  assert.deepEqual(v.primary, {
    action: { kind: "installEdition", edition: "small" },
    disabled: false,
  });
});

// D17: the requirement is the archive plus its extraction, not the download.
test("the space warning quotes the free space needed, not the download size", () => {
  const tight = requiredFreeBytes(pinnedRelease("small").size) + 1;
  const v = view({ preferred: "full", freeBytes: tight });
  assert.equal(v.message.kind, "spaceForOther");
  if (v.message.kind !== "spaceForOther") return;
  assert.equal(v.message.needed, requiredFreeBytes(pinnedRelease("small").size));
  assert.notEqual(v.message.needed, pinnedRelease("small").size);
});

// S3
test("a disk that fits nothing disables the button rather than offering a dead press", () => {
  const v = view({ freeBytes: 1 });
  assert.equal(v.message.kind, "noSpace");
  assert.equal(v.primary.disabled, true);
});

test("an unknown free space is not treated as no space", () => {
  const v = view({ freeBytes: undefined });
  assert.equal(v.message.kind, "absent");
  assert.equal(v.primary.disabled, false);
});

// S4
test("the selection installed offers an update and does not name the edition twice", () => {
  const v = view({ inventory: installed(["core"], { core: "20260723" }) });
  assert.deepEqual(v.message, {
    kind: "installed",
    edition: "core",
    version: "20260723",
    isSelection: true,
    upToDate: false,
  });
  assert.deepEqual(v.primary, { action: { kind: "update" }, disabled: false });
  assert.equal(v.dot, "ready");
});

test("an installed dictionary with no recorded version still reads as installed", () => {
  const v = view({ inventory: installed(["core"]) });
  assert.equal(v.message.kind, "installed");
  if (v.message.kind !== "installed") return;
  assert.equal(v.message.version, undefined);
});

// S6. The description names an edition only when it differs from the selection,
// which is what stops the picker and the description saying the same thing.
test("a selection that is not the installed edition offers a switch", () => {
  const v = view({ preferred: "full", inventory: installed(["core"], { core: "20260723" }) });
  assert.equal(v.message.kind, "installed");
  if (v.message.kind !== "installed") return;
  assert.equal(v.message.isSelection, false);
  assert.equal(v.message.edition, "core");
  assert.deepEqual(v.primary, { action: { kind: "switch" }, disabled: false });
});

// S7
test("resolving disables the picker and says what it is doing", () => {
  const v = view({ job: job({ kind: "resolving", edition: "core" }) });
  assert.deepEqual(v.message, { kind: "checking" });
  assert.deepEqual(v.primary, { action: { kind: "working", of: "checking" }, disabled: true });
  // A source that is timing out is exactly when Cancel is reached for.
  assert.deepEqual(v.cancel, { shown: true, disabled: false });
  assert.equal(v.pickerEnabled, false);
  assert.equal(v.settling, true);
});

// S8
test("downloading carries progress and the one cancel that works", () => {
  const v = view({
    job: job({ kind: "downloading", edition: "core", received: 100, total: 500 }),
  });
  assert.deepEqual(v.message, { kind: "downloading", received: 100, total: 500 });
  assert.deepEqual(v.cancel, { shown: true, disabled: false });
  assert.equal(v.pickerEnabled, false);
});

// S9 and S10: the two phases that are long, measurable and safe to abandon.
test("verifying and unpacking carry their own progress and can be cancelled", () => {
  for (const phase of ["verifying", "extracting"] as const) {
    const v = view({
      job: job({ kind: "installing", edition: "core", phase, done: 41, total: 69 }),
    });
    assert.deepEqual(v.message, { kind: "installing", phase, done: 41, total: 69 });
    assert.deepEqual(v.cancel, { shown: true, disabled: false });
    assert.equal(v.primary.disabled, true);
    assert.equal(v.pickerEnabled, false);
  }
});

// S11. Past the swap the old dictionary is already unloaded and the rename may
// have landed, so there is nothing safe to stop. The button stays visible
// because one that vanishes at that moment reads as a bug.
test("the swap and the load show cancel disabled rather than removing it", () => {
  for (const phase of ["swapping", "loading"] as const) {
    const v = view({
      job: job({ kind: "installing", edition: "core", phase, done: 0, total: 0 }),
    });
    assert.deepEqual(v.cancel, { shown: true, disabled: true });
    assert.equal(v.primary.disabled, true);
  }
});

// D14: the label used to stay "Update" for the whole install.
test("the button never keeps its idle label while working", () => {
  for (const running of [
    job({ kind: "resolving", edition: "core" }),
    job({ kind: "downloading", edition: "core", received: 1, total: 2 }),
    job({ kind: "installing", edition: "core", phase: "extracting", done: 1, total: 2 }),
  ]) {
    const v = view({ inventory: installed(["core"]), job: running });
    assert.equal(v.primary.action.kind, "working");
  }
});

// S12
test("up to date says so over the installed state, with the button held", () => {
  const v = view({
    inventory: installed(["core"], { core: "20260723" }),
    job: job({ kind: "upToDate", edition: "core", at: NOW }),
  });
  assert.equal(v.message.kind, "installed");
  if (v.message.kind !== "installed") return;
  assert.equal(v.message.upToDate, true);
  assert.equal(v.primary.disabled, true);
  assert.equal(v.settling, true);
});

test("up to date expires on its own instead of needing a timer", () => {
  const v = view({
    inventory: installed(["core"], { core: "20260723" }),
    job: job({ kind: "upToDate", edition: "core", at: NOW - DICTIONARY_COOLDOWN_MS }),
  });
  assert.equal(v.message.kind, "installed");
  if (v.message.kind !== "installed") return;
  assert.equal(v.message.upToDate, false);
  assert.equal(v.primary.disabled, false);
  assert.equal(v.settling, false);
});

// S13, and D11: the hole was the button re-enabling ~300ms into a click.
test("a retryable failure offers retry, but not immediately", () => {
  const v = view({ job: job({ kind: "failed", edition: "core", reason: "checksum", at: NOW }) });
  assert.deepEqual(v.message, { kind: "failed", reason: "checksum" });
  assert.deepEqual(v.primary, { action: { kind: "retry" }, disabled: true });
});

test("retry becomes pressable once the cooldown elapses", () => {
  const v = view({
    job: job({ kind: "failed", edition: "core", reason: "checksum", at: NOW - DICTIONARY_COOLDOWN_MS }),
  });
  assert.deepEqual(v.primary, { action: { kind: "retry" }, disabled: false });
  assert.equal(v.settling, false);
});

// S14, and D18: the first real use of isRetryable. Retrying `no-source` repeats
// the same two refused requests, so a Retry button would be a lie.
test("no-source offers the normal action disabled, never a retry", () => {
  const v = view({
    inventory: installed(["core"], { core: "20260723" }),
    job: job({ kind: "failed", edition: "core", reason: "no-source", at: NOW }),
  });
  assert.deepEqual(v.message, { kind: "updateCheckFailed" });
  assert.deepEqual(v.primary, { action: { kind: "update" }, disabled: true });
});

// S15: one condition, one wording. A disk-space failure reads exactly like the
// eager check that should have caught it first.
test("a disk-space failure gives the same answer as the eager check", () => {
  const tight = requiredFreeBytes(pinnedRelease("small").size) + 1;
  const failed = view({
    preferred: "full",
    freeBytes: tight,
    job: job({ kind: "failed", edition: "full", reason: "disk-space", at: NOW }),
  });
  const eager = view({ preferred: "full", freeBytes: tight });
  assert.deepEqual(failed.message, eager.message);
  assert.deepEqual(failed.primary.action, eager.primary.action);
});

// S16: cancelling is not a fault, so the row says so once and then offers
// exactly what it offered before the press.
test("cancelling reads as neutral and restores the previous action", () => {
  const v = view({
    inventory: installed(["core"], { core: "20260723" }),
    job: job({ kind: "failed", edition: "core", reason: "cancelled", at: NOW }),
  });
  assert.deepEqual(v.message, { kind: "cancelled" });
  assert.equal(v.dot, "neutral");
  assert.deepEqual(v.primary, { action: { kind: "update" }, disabled: false });
});

test("a cancelled job stops being mentioned after the cooldown", () => {
  const v = view({
    inventory: installed(["core"], { core: "20260723" }),
    job: job({ kind: "failed", edition: "core", reason: "cancelled", at: NOW - DICTIONARY_COOLDOWN_MS }),
  });
  assert.equal(v.message.kind, "installed");
});

// D16: the picker was live during a download, so the preference could be
// rewritten under an install that was already fetching a different edition.
test("the picker is off exactly while an install is running", () => {
  const running: DictionaryJob[] = [
    { kind: "resolving", edition: "core" },
    { kind: "downloading", edition: "core", received: 1, total: 2 },
    { kind: "installing", edition: "core", phase: "extracting", done: 1, total: 2 },
  ];
  for (const j of running) assert.equal(view({ job: j }).pickerEnabled, false);

  const settled: DictionaryJob[] = [
    { kind: "idle" },
    { kind: "failed", edition: "core", reason: "checksum", at: NOW },
    { kind: "upToDate", edition: "core", at: NOW },
  ];
  for (const j of settled) assert.equal(view({ job: j }).pickerEnabled, true);
});

// A load failure keeps the file and the version, so the row must not go back to
// claiming nothing is installed.
test("a failed load still reports the dictionary as present underneath", () => {
  const v = view({
    inventory: installed(["core"], { core: "20260723" }),
    job: job({ kind: "failed", edition: "core", reason: "load", at: NOW - DICTIONARY_COOLDOWN_MS }),
  });
  assert.deepEqual(v.message, { kind: "failed", reason: "load" });
  assert.equal(v.primary.action.kind, "retry");
});

// Both editions on disk, one of them open. Nothing needs downloading, but
// pressing the button still changes which dictionary reads the lyrics, so the
// label follows the outcome rather than the absence of a transfer. It used to
// say Update, and pressing it reported "already the newest release" while the
// analyzer went on serving the other one until the next launch.
test("an installed edition that is not the loaded one offers a switch", () => {
  const v = view({
    preferred: "core",
    inventory: { installed: ["full", "core"], versions: { full: "20260723" }, loaded: "full" },
  });
  assert.deepEqual(v.primary, { action: { kind: "switch" }, disabled: false });
  assert.equal(v.message.kind, "installed");
  if (v.message.kind !== "installed") return;
  assert.equal(v.message.edition, "full", "the description names what is open, not what is wanted");
  assert.equal(v.message.isSelection, false);
});

test("the loaded edition being the selection is still an update", () => {
  const v = view({
    preferred: "core",
    inventory: { installed: ["full", "core"], versions: { core: "20260723" }, loaded: "core" },
  });
  assert.deepEqual(v.primary, { action: { kind: "update" }, disabled: false });
});
