// What the dictionary row shows, as a value.
//
// The row used to compute this inline from a status string, which is where four
// defects lived at once: the button re-enabled about 300 ms into any click
// because `disabled` came from the status alone, so a second press started a
// concurrent install; the edition and its size were printed by the picker and
// again by the description; the button kept its idle label while working; and
// the space warning quoted the archive size where the disk requirement is more
// than three times that.
//
// Returns **kinds and raw numbers, never formatted text**. Dates, megabytes and
// wording belong to the panel's language, which this module must not know about
// (`src/engine` cannot import from `src/host`). The caller formats.
//
// Pure: no DOM, no native calls, no clock. `now` is a parameter so a cooldown
// is a function of its inputs rather than a `setTimeout` the panel has to own
// and clean up.

import {
  DICTIONARY_EDITIONS,
  isRetryable,
  largestEditionThatFits,
  requiredFreeBytes,
  type DictionaryEdition,
  type DictionaryFailure,
} from "./dictionarySource.ts";
import { pinnedRelease } from "./dictionaryPins.ts";
import type { DictionaryInventory, DictionaryJob, InstallPhase } from "./dictionaryState.ts";

/**
 * How long a finished job keeps saying so.
 *
 * Long enough to read "already the newest release" before the row goes back to
 * looking untouched, short enough that it is not in the way. It also doubles as
 * the retry cooldown, which is what stops a double click starting two installs.
 */
export const DICTIONARY_COOLDOWN_MS = 4000;

export type RowDot = "ready" | "loading" | "bad" | "neutral";

/**
 * What the description says. A discriminated union rather than a preformatted
 * string, so the panel owns every word and this module owns the decision.
 */
export type RowMessage =
  | { readonly kind: "absent"; readonly edition: DictionaryEdition; readonly version: string }
  | {
      readonly kind: "installed";
      readonly edition: DictionaryEdition;
      readonly version: string | undefined;
      /** False when the installed edition is not the one selected, which is the only time it is named. */
      readonly isSelection: boolean;
      readonly upToDate: boolean;
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
  | { readonly kind: "noSpace"; readonly needed: number }
  | {
      readonly kind: "spaceForOther";
      readonly wanted: DictionaryEdition;
      readonly fits: DictionaryEdition;
      readonly needed: number;
    };

export type RowAction =
  | { readonly kind: "install" }
  | { readonly kind: "update" }
  | { readonly kind: "switch" }
  | { readonly kind: "retry" }
  /** Install something other than the selection, because the selection does not fit. */
  | { readonly kind: "installEdition"; readonly edition: DictionaryEdition }
  | { readonly kind: "working"; readonly of: "checking" | "downloading" | "installing" };

export type RowView = {
  readonly dot: RowDot;
  readonly message: RowMessage;
  readonly primary: { readonly action: RowAction; readonly disabled: boolean };
  /** Always in the DOM so the row never changes height; `shown` toggles visibility. */
  readonly cancel: { readonly shown: boolean; readonly disabled: boolean };
  /** Off while an install runs, so the preference cannot be rewritten mid-flight. */
  readonly pickerEnabled: boolean;
  /** The view will change without further input (progress, or a cooldown expiring). */
  readonly settling: boolean;
};

export type RowInput = {
  readonly preferred: DictionaryEdition;
  readonly inventory: DictionaryInventory;
  readonly job: DictionaryJob;
  readonly now: number;
  /** Bytes free where the dictionary lives, or undefined when the disk could not be asked. */
  readonly freeBytes: number | undefined;
};

export function dictionaryRowState(input: RowInput): RowView {
  const running = runningView(input);
  if (running) return running;

  const settled = settledView(input);
  const recent = recentOutcomeView(input);
  return recent ?? settled;
}

/**
 * Everything that is actively happening. The picker is off throughout, and the
 * primary button carries a working label rather than the one it will have when
 * the work stops.
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
      // Cancel stays *shown* through all four phases and is only enabled for
      // the two that can be abandoned. After the swap begins the old dictionary
      // is already unloaded and the rename may have landed, so there is nothing
      // safe to stop; a button that vanishes at that moment reads as a bug,
      // where a disabled one reads as "not now".
      return working(
        {
          kind: "installing",
          phase: job.phase,
          done: job.done,
          total: job.total,
        },
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
    pickerEnabled: false,
    settling: true,
  };
}

/**
 * How a finished job reads while its cooldown runs, or undefined once it has
 * elapsed and the row goes back to describing the disk.
 *
 * The cooldown is what closes the double-click hole: a failure or an up-to-date
 * answer keeps the button disabled for a beat instead of re-enabling the moment
 * the status stops being "downloading".
 */
function recentOutcomeView(input: RowInput): RowView | undefined {
  const { job, now } = input;
  if (job.kind !== "failed" && job.kind !== "upToDate") return undefined;
  const cooling = now - job.at < DICTIONARY_COOLDOWN_MS;

  if (job.kind === "upToDate") {
    if (!cooling) return undefined;
    const settled = settledView(input);
    const message = settled.message;
    return {
      ...settled,
      message: message.kind === "installed" ? { ...message, upToDate: true } : message,
      primary: { action: settled.primary.action, disabled: true },
      settling: true,
    };
  }

  // Cancelling is not a fault. The row says so once and then goes back to
  // offering exactly what it offered before the button was pressed.
  if (job.reason === "cancelled") {
    if (!cooling) return undefined;
    const settled = settledView(input);
    return { ...settled, dot: "neutral", message: { kind: "cancelled" }, settling: true };
  }

  // A disk-space failure is the same question as the eager check, so it gets the
  // same answer rather than a second wording for one condition.
  if (job.reason === "disk-space") {
    const space = spaceView(input, job.edition);
    if (space) return { ...space, settling: cooling };
  }

  // `no-source` means every metadata endpoint refused, so a retry repeats the
  // same two requests. Offer the normal action, disabled, instead of a Retry
  // that cannot work.
  if (!isRetryable(job.reason)) {
    const settled = settledView(input);
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
    pickerEnabled: true,
    settling: cooling,
  };
}

/** What the disk says, with nothing running and no recent outcome to report. */
function settledView(input: RowInput): RowView {
  const { preferred, inventory } = input;
  const installed = inventory.loaded ?? inventory.installed[0];

  if (installed !== undefined && inventory.installed.includes(preferred)) {
    return {
      dot: "ready",
      message: {
        kind: "installed",
        edition: installed,
        version: inventory.versions[installed],
        isSelection: installed === preferred,
        upToDate: false,
      },
      primary: { action: { kind: "update" }, disabled: false },
      cancel: { shown: false, disabled: true },
      pickerEnabled: true,
      settling: false,
    };
  }

  // From here the selection is not on disk, so the action downloads it and the
  // free-space question is live *before* the click rather than after it.
  const space = spaceView(input, preferred);
  if (space) return space;

  if (installed !== undefined) {
    return {
      dot: "ready",
      message: {
        kind: "installed",
        edition: installed,
        version: inventory.versions[installed],
        isSelection: false,
        upToDate: false,
      },
      primary: { action: { kind: "switch" }, disabled: false },
      cancel: { shown: false, disabled: true },
      pickerEnabled: true,
      settling: false,
    };
  }

  return {
    dot: "bad",
    message: { kind: "absent", edition: preferred, version: pinnedRelease(preferred).version },
    primary: { action: { kind: "install" }, disabled: false },
    cancel: { shown: false, disabled: true },
    pickerEnabled: true,
    settling: false,
  };
}

/**
 * The two disk-space answers, or undefined when the wanted edition fits.
 *
 * Quotes `requiredFreeBytes`, not the archive size: the archive and its
 * extraction exist at once, so 121 MB of download needs about 548 MB free. The
 * row used to print the download size next to the words "not enough space",
 * which understates the requirement by more than a factor of four.
 */
function spaceView(input: RowInput, wanted: DictionaryEdition): RowView | undefined {
  const { freeBytes } = input;
  if (freeBytes === undefined) return undefined;
  const needed = requiredFreeBytes(pinnedRelease(wanted).size);
  if (freeBytes >= needed) return undefined;

  const sizes = new Map<DictionaryEdition, number>(
    DICTIONARY_EDITIONS.map((edition) => [edition, pinnedRelease(edition).size]),
  );
  const fits = largestEditionThatFits(freeBytes, sizes);

  if (fits === undefined) {
    return {
      dot: "bad",
      message: { kind: "noSpace", needed: requiredFreeBytes(pinnedRelease("small").size) },
      primary: { action: { kind: "install" }, disabled: true },
      cancel: { shown: false, disabled: true },
      pickerEnabled: true,
      settling: false,
    };
  }

  return {
    dot: "bad",
    message: {
      kind: "spaceForOther",
      wanted,
      fits,
      needed: requiredFreeBytes(pinnedRelease(fits).size),
    },
    primary: { action: { kind: "installEdition", edition: fits }, disabled: false },
    cancel: { shown: false, disabled: true },
    pickerEnabled: true,
    settling: false,
  };
}
