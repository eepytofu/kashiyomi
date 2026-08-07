// What the dictionary control shows, as a value.
//
// The row used to compute this inline from a status string, which is where four
// defects lived at once: the button re-enabled about 300 ms into any click, so a
// second press started a concurrent install; the size was printed twice; the
// button kept its idle label while working; and the space warning quoted the
// archive size where the disk requirement is more than three times that.
//
// Returns **kinds and raw numbers, never formatted text**. Dates, megabytes and
// wording belong to the panel's language, which this module must not know about
// (`src/engine` cannot import from `src/host`). The caller formats.
//
// Pure: no DOM, no native calls, no clock. `now` is a parameter so a cooldown is
// a function of its inputs rather than a `setTimeout` the panel has to own.

import { isRetryable, requiredFreeBytes, type DictionaryFailure } from "./dictionarySource.ts";
import { pinnedRelease } from "./dictionaryPins.ts";
import type { DictionaryInventory, DictionaryJob, InstallPhase } from "./dictionaryState.ts";

/**
 * How long a finished job keeps saying so.
 *
 * Long enough to read "already the newest release" before the control goes back
 * to looking untouched, short enough not to be in the way. It doubles as the
 * retry cooldown, which is what stops a double click starting two installs.
 */
export const DICTIONARY_COOLDOWN_MS = 4000;

export type RowDot = "ready" | "loading" | "bad" | "neutral";

/**
 * What the description says. A discriminated union rather than a preformatted
 * string, so the panel owns every word and this module owns the decision.
 */
export type RowMessage =
  | { readonly kind: "absent"; readonly version: string }
  | {
      readonly kind: "installed";
      readonly version: string | undefined;
      readonly upToDate: boolean;
      /**
       * A check has seen a release newer than the one on disk.
       *
       * Derived from the inventory rather than from a job, so it stays true
       * until something is done about it instead of fading with a cooldown.
       * Both versions must be known: a dictionary placed on disk from outside
       * the plugin has no recorded version, and "unknown" is not "behind".
       */
      readonly updateAvailable: boolean;
    }
  | { readonly kind: "checking" }
  | { readonly kind: "downloading"; readonly received: number; readonly total: number }
  | {
      readonly kind: "installing";
      readonly phase: InstallPhase;
      readonly done: number;
      readonly total: number;
    }
  | { readonly kind: "failed"; readonly reason: DictionaryFailure }
  | { readonly kind: "updateCheckFailed" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "noSpace"; readonly needed: number };

export type RowAction =
  | { readonly kind: "install" }
  | { readonly kind: "update" }
  | { readonly kind: "retry" }
  | { readonly kind: "working"; readonly of: "checking" | "downloading" | "installing" };

export type RowView = {
  readonly dot: RowDot;
  readonly message: RowMessage;
  readonly primary: { readonly action: RowAction; readonly disabled: boolean };
  /** Always in the DOM so the control never changes height; `shown` toggles visibility. */
  readonly cancel: { readonly shown: boolean; readonly disabled: boolean };
  /** The view will change without further input (progress, or a cooldown expiring). */
  readonly settling: boolean;
};

export type RowInput = {
  readonly inventory: DictionaryInventory;
  readonly job: DictionaryJob;
  readonly now: number;
  /** Bytes free where the dictionary lives, or undefined when the disk could not be asked. */
  readonly freeBytes: number | undefined;
  /**
   * Whether this surface is the one whose button was pressed.
   *
   * A **running** job is a fact about the dictionary and every surface should
   * show it. An **outcome** is a report of an action, and belongs only where
   * the action was taken. Without the distinction, opening settings displayed
   * "already the newest release" from a check the row had never performed,
   * which asserts a result rather than describing a state.
   */
  readonly ownsJob?: boolean;
};

/**
 * Whether a check has seen something newer than what is installed.
 *
 * Both sides must be known. A dictionary put on disk from outside the plugin
 * has no recorded version, and treating unknown as behind would offer an update
 * nobody can say is needed.
 */
function hasUpdate(inventory: DictionaryInventory): boolean {
  const { version, latest } = inventory;
  return version !== undefined && latest !== undefined && version !== latest;
}

export function dictionaryRowState(input: RowInput): RowView {
  const running = runningView(input);
  if (running) return running;

  const settled = settledView(input);
  return recentOutcomeView(input, settled) ?? settled;
}

/**
 * Everything actively happening. The primary button carries a working label
 * rather than the one it will have when the work stops.
 */
function runningView(input: RowInput): RowView | undefined {
  const { job } = input;
  switch (job.kind) {
    case "resolving":
      // Cancellable: the update check is a `fetch` behind the same abort
      // controller the transfer uses, and a source that is timing out is
      // exactly when someone reaches for this.
      return working({ kind: "checking" }, "checking", true);
    case "downloading":
      // The one window where cancelling is both safe and implemented: nothing
      // has been written to the live path and the transfer holds an abort
      // signal.
      return working(
        { kind: "downloading", received: job.received, total: job.total },
        "downloading",
        true,
      );
    case "installing":
      // Cancel stays *shown* through all four phases and is enabled only for
      // the two that can be abandoned. After the swap begins the old dictionary
      // is already unloaded and the rename may have landed, so there is nothing
      // safe to stop; a button that vanishes at that moment reads as a bug,
      // where a disabled one reads as "not now".
      return working(
        { kind: "installing", phase: job.phase, done: job.done, total: job.total },
        "installing",
        job.phase === "verifying" || job.phase === "extracting",
      );
    default:
      return undefined;
  }
}

function working(
  message: RowMessage,
  of: "checking" | "downloading" | "installing",
  cancellable: boolean,
): RowView {
  return {
    dot: "loading",
    message,
    primary: { action: { kind: "working", of }, disabled: true },
    cancel: { shown: true, disabled: !cancellable },
    settling: true,
  };
}

/**
 * How a finished job reads while its cooldown runs, or undefined once it has
 * elapsed and the control goes back to describing the disk.
 *
 * The cooldown is what closes the double-click hole: a failure or an up-to-date
 * answer keeps the button disabled for a beat instead of re-enabling the moment
 * the status stops being "downloading".
 */
function recentOutcomeView(input: RowInput, settled: RowView): RowView | undefined {
  const { job, now } = input;
  if (input.ownsJob === false) return undefined;
  if (job.kind !== "failed" && job.kind !== "upToDate") return undefined;
  const cooling = now - job.at < DICTIONARY_COOLDOWN_MS;

  if (job.kind === "upToDate") {
    if (!cooling) return undefined;
    const message = settled.message;
    return {
      ...settled,
      message: message.kind === "installed" ? { ...message, upToDate: true } : message,
      primary: { action: settled.primary.action, disabled: true },
      settling: true,
    };
  }

  // Cancelling is not a fault. The control says so once and then goes back to
  // offering exactly what it offered before the button was pressed.
  if (job.reason === "cancelled") {
    if (!cooling) return undefined;
    return { ...settled, dot: "neutral", message: { kind: "cancelled" }, settling: true };
  }

  // A disk-space failure is the same question as the eager check, so it gets
  // the same answer rather than a second wording for one condition.
  if (job.reason === "disk-space") {
    const space = spaceView(input);
    if (space) return { ...space, settling: cooling };
  }

  // `no-source` means every metadata endpoint refused, so a retry repeats the
  // same two requests. Offer the normal action, disabled, instead of a Retry
  // that cannot work.
  if (!isRetryable(job.reason)) {
    return {
      ...settled,
      dot: "bad",
      message: { kind: "updateCheckFailed" },
      primary: { action: settled.primary.action, disabled: true },
      settling: cooling,
    };
  }

  return {
    dot: "bad",
    message: { kind: "failed", reason: job.reason },
    primary: { action: { kind: "retry" }, disabled: cooling },
    cancel: { shown: false, disabled: true },
    settling: cooling,
  };
}

/** What the disk says, with nothing running and no recent outcome to report. */
function settledView(input: RowInput): RowView {
  const { inventory } = input;

  if (inventory.installed) {
    return {
      dot: "ready",
      message: {
        kind: "installed",
        version: inventory.version,
        upToDate: false,
        updateAvailable: hasUpdate(inventory),
      },
      primary: { action: { kind: "update" }, disabled: false },
      cancel: { shown: false, disabled: true },
      settling: false,
    };
  }

  // Nothing on disk, so the action downloads it and the free-space question is
  // live *before* the click rather than after it.
  const space = spaceView(input);
  if (space) return space;

  return {
    dot: "bad",
    message: { kind: "absent", version: pinnedRelease().version },
    primary: { action: { kind: "install" }, disabled: false },
    cancel: { shown: false, disabled: true },
    settling: false,
  };
}

/**
 * The disk-space answer, or undefined when there is room.
 *
 * Quotes `requiredFreeBytes`, not the archive size: the archive and its
 * extraction exist at once, so 69 MB of download needs about 340 MB free. The
 * control used to print the download size next to the words "not enough space",
 * understating the requirement by more than a factor of four.
 *
 * There is no smaller edition to offer any more, so this states the requirement
 * and stops. That is a real answer rather than a loop to retry: Japanese
 * annotation is unavailable on that machine, while pinyin, kanji repair and
 * translation keep working, so it is a missing feature and not a broken plugin.
 */
function spaceView(input: RowInput): RowView | undefined {
  const { freeBytes } = input;
  if (freeBytes === undefined) return undefined;
  const needed = requiredFreeBytes(pinnedRelease().size);
  if (freeBytes >= needed) return undefined;

  return {
    dot: "bad",
    message: { kind: "noSpace", needed },
    primary: { action: { kind: "install" }, disabled: true },
    cancel: { shown: false, disabled: true },
    settling: false,
  };
}
