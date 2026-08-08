// What the dictionary control shows, as a value.

import { isRetryable, requiredFreeBytes, type DictionaryFailure } from "./dictionarySource.ts";
import { pinnedRelease } from "./dictionaryPins.ts";
import type { DictionaryInventory, DictionaryJob, InstallPhase } from "./dictionaryState.ts";

/** How long a finished job keeps saying so. */
export const DICTIONARY_COOLDOWN_MS = 4000;

/** How long a check that found nothing suppresses the **automatic** check. */
export const CHECK_INTERVAL_MS = 30 * 60 * 1000;

/** How long the button stays down after a check that found nothing. */
export const RECHECK_COOLDOWN_MS = 5 * 60 * 1000;

/** How long a check must run before the row says it is checking. */
export const CHECK_BUSY_AFTER_MS = 400;

export type RowDot = "ready" | "loading" | "bad" | "neutral";

/**
 * The analyzer states worth reporting. Not the backend's full set: `ready` says
 * nothing a user needs, and `uninitialized` only happens when there is no
 * dictionary to load, which the row already says in plainer words.
 */
export type AnalyzerState = "loading" | "failed";

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
      /** A check has seen a release newer than the one on disk. */
      readonly updateAvailable: boolean;
      /**
       * How long ago the last check was, when that is why the button is down.
       * Undefined the rest of the time, so the row only explains a state the
       * reader can currently see.
       */
      readonly checkedAgoMs: number | undefined;
      /**
       * What the analyzer is doing with the file on disk, when that is worth
       * saying. Undefined once it is open, which is the ordinary case and needs
       * no words.
       */
      readonly analyzer: AnalyzerState | undefined;
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
  | { readonly kind: "cancel" }
  | { readonly kind: "working"; readonly of: "checking" | "installing" };

/** One button, always in the same place, naming the only action available. */
export type RowView = {
  readonly dot: RowDot;
  readonly message: RowMessage;
  readonly primary: { readonly action: RowAction; readonly disabled: boolean };
  /** The view will change without further input (progress, or a cooldown expiring). */
  readonly settling: boolean;
  /**
   * When the view next changes on its own, for a wait too long to poll through.
   * `settling` drives a 300ms repaint timer, which is right for progress and
   * wrong for five minutes of it.
   */
  readonly settlesAt?: number;
};

export type RowInput = {
  readonly inventory: DictionaryInventory;
  readonly job: DictionaryJob;
  readonly now: number;
  /** Bytes free where the dictionary lives, or undefined when the disk could not be asked. */
  readonly freeBytes: number | undefined;
  /** Whether this surface is the one whose button was pressed. */
  readonly ownsJob?: boolean;
  /** Read fresh at paint time, never stored. */
  readonly analyzer?: AnalyzerState;
};

/** Whether a check has seen something newer than what is installed. */
function hasUpdate(inventory: DictionaryInventory): boolean {
  const { version, latest } = inventory;
  return version !== undefined && latest !== undefined && version !== latest;
}

export function dictionaryRowState(input: RowInput): RowView {
  const running = runningView(input);
  if (running) return running;

  const settled = settledView(input);

  // A check too young to announce: hold the row exactly as it was, minus the
  // ability to press it again. `settling` keeps the repaint timer alive so the
  // row can still promote itself to the busy view if the check does drag on.
  if (input.job.kind === "resolving") {
    return {
      ...settled,
      primary: { action: settled.primary.action, disabled: true },
      settling: true,
    };
  }

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
      // Only once it has lasted long enough to be read; the caller holds the
      // settled view until then.
      return input.now - job.at < CHECK_BUSY_AFTER_MS ? undefined : busy({ kind: "checking" });
    case "downloading":
      // The clearest window where cancelling is both safe and implemented:
      // nothing has been written to the live path and the transfer holds an
      // abort signal.
      return cancellable({ kind: "downloading", received: job.received, total: job.total });
    case "installing": {
      const message: RowMessage = {
        kind: "installing",
        phase: job.phase,
        done: job.done,
        total: job.total,
      };
      // Verifying and extracting still have nothing on the live path, so they
      return job.phase === "verifying" || job.phase === "extracting"
        ? cancellable(message)
        : busy(message);
    }
    default:
      return undefined;
  }
}

/** Work in progress that cannot be stopped: the button names it and is dead. */
function busy(message: RowMessage): RowView {
  const of = message.kind === "checking" ? "checking" : "installing";
  return {
    dot: "loading",
    message,
    primary: { action: { kind: "working", of }, disabled: true },
    settling: true,
  };
}

/** Work in progress that can be abandoned: the button becomes the way out. */
function cancellable(message: RowMessage): RowView {
  return {
    dot: "loading",
    message,
    primary: { action: { kind: "cancel" }, disabled: false },
    settling: true,
  };
}

/**
 * How a failure reads while its cooldown runs, or undefined once it has elapsed
 * and the control goes back to describing the disk.
 */
function recentOutcomeView(input: RowInput, settled: RowView): RowView | undefined {
  const { job, now } = input;
  if (input.ownsJob === false) return undefined;
  if (job.kind !== "failed") return undefined;
  const cooling = now - job.at < DICTIONARY_COOLDOWN_MS;

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
    settling: cooling,
  };
}

/** What the disk says, with nothing running and no recent outcome to report. */
function settledView(input: RowInput): RowView {
  const { inventory, now } = input;

  if (inventory.installed) {
    const updateAvailable = hasUpdate(inventory);
    // A check within the interval that found nothing is the one case worth
    // holding the button down for: pressing again cannot return an answer the
    // last check did not already have.
    const fresh =
      !updateAvailable &&
      inventory.checkedAt !== undefined &&
      now - inventory.checkedAt < CHECK_INTERVAL_MS;

    // The ordinary double-click guard, read off the same timestamp rather than
    // out of a job: a press that found nothing sets `checkedAt`, so the seconds
    // after it are exactly the window worth holding the button for.
    const checkedAt = inventory.checkedAt;
    const cooling =
      !updateAvailable && checkedAt !== undefined && now - checkedAt < RECHECK_COOLDOWN_MS;

    return {
      dot: "ready",
      message: {
        kind: "installed",
        version: inventory.version,
        upToDate: fresh,
        updateAvailable,
        checkedAgoMs: cooling && checkedAt !== undefined ? now - checkedAt : undefined,
        analyzer: input.analyzer,
      },
      // **Live once the guard passes.** The interval exists to stop the plugin
      primary: { action: { kind: "update" }, disabled: cooling },
      // Not `settling`: that polls every 300ms, and five minutes of it would
      // repaint a thousand times to watch one deadline. The row schedules a
      // single timer for `settlesAt` instead.
      settling: false,
      settlesAt: cooling && checkedAt !== undefined ? checkedAt + RECHECK_COOLDOWN_MS : undefined,
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
    settling: false,
  };
}

/** The disk-space answer, or undefined when there is room. */
function spaceView(input: RowInput): RowView | undefined {
  const { freeBytes } = input;
  if (freeBytes === undefined) return undefined;
  const needed = requiredFreeBytes(pinnedRelease().size);
  if (freeBytes >= needed) return undefined;

  return {
    dot: "bad",
    message: { kind: "noSpace", needed },
    primary: { action: { kind: "install" }, disabled: true },
    settling: false,
  };
}
