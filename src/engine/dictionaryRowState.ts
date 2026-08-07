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
 * Long enough to read a failure before the control goes back to looking
 * untouched, short enough not to be in the way. It doubles as the retry
 * cooldown, which is what stops a double click starting two installs.
 *
 * **Not the update interval.** This one is about a press that just happened;
 * `CHECK_INTERVAL_MS` is about how often asking is worth anything at all.
 */
export const DICTIONARY_COOLDOWN_MS = 4000;

/**
 * How long a check that found nothing keeps the button down.
 *
 * SudachiDict ships roughly quarterly, so a check seconds after the last one
 * cannot return anything the last one did not. The old 4s cooldown was sized as
 * a double-click guard and gated re-checking only by accident.
 *
 * Gates **checking, never installing**: once a check has found a newer release
 * the button stays live, because that press downloads rather than asks.
 */
export const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

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
  | { readonly kind: "cancel" }
  | { readonly kind: "working"; readonly of: "checking" | "installing" };

/**
 * One button, always in the same place, naming the only action available.
 *
 * There was a second Cancel button beside it until 2026-08-07. It appeared and
 * vanished inside the ~1s an update check takes, which is flicker rather than an
 * affordance, and it rendered wedged between the description and the primary
 * button because the row is `space-between`. Folding cancellation into the one
 * button removes both: the position never changes, and the label is whatever
 * pressing it would do right now.
 *
 * Nothing is lost by the button no longer reading "Downloading…" — the
 * description beside it already carries `downloading 34.2 / 68.9 MB`.
 */
export type RowView = {
  readonly dot: RowDot;
  readonly message: RowMessage;
  readonly primary: { readonly action: RowAction; readonly disabled: boolean };
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
      // **Not cancellable, deliberately.** Two HTTP requests that finish in
      // about a second: a Cancel here only ever appeared and disappeared before
      // it could be aimed at. If a source hangs, `fetch` fails on its own and
      // the row offers Retry.
      return busy({ kind: "checking" });
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
      // can be abandoned. Past the swap the old dictionary is already unloaded
      // and the rename may have landed, so there is nothing safe to stop: the
      // button keeps its place and reads as busy instead of offering a stop
      // that would not be honoured.
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
 *
 * The cooldown is what closes the double-click hole: a failure keeps the button
 * disabled for a beat instead of re-enabling the moment the status stops being
 * "downloading".
 *
 * Only failures reach here. "Already the newest release" used to be a job kind
 * with its own branch, faking a durable answer out of a 4s cooldown; it is a
 * recorded timestamp now, so `settledView` states it as the fact it is.
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
    //
    // `!updateAvailable` guards it, and that guard is the point. Once something
    // newer has been seen the button installs rather than asks, and refusing
    // that press would strand a user in front of an update they can see and
    // cannot take.
    const fresh =
      !updateAvailable &&
      inventory.checkedAt !== undefined &&
      now - inventory.checkedAt < CHECK_INTERVAL_MS;

    return {
      dot: "ready",
      message: {
        kind: "installed",
        version: inventory.version,
        upToDate: fresh,
        updateAvailable,
      },
      primary: { action: { kind: "update" }, disabled: fresh },
      // Never `true` here. `settling` starts a repaint timer and this window is
      // twelve hours, so the panel would poll for as long as it stayed open.
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
    settling: false,
  };
}
