// Three facts about the dictionary, kept apart because one field could not
// answer all three.
//
// Authority per fact, and none of the three can answer for another:
//
//   whether it is installed  -> the disk (a directory listing)
//   which release it is      -> recorded when the plugin installed it
//
// Whether the analyzer has it *open* is deliberately not here. It was, as a
// boolean captured at boot, and the dictionary loads on a background thread, so
// it was captured as false and never corrected: the debug handle reported
// `loaded: false` over an analyzer that had been ready for minutes. Nothing
// read it. `nativeState()` is the live authority and the panel's status bar
// already shows it.
//
// The last one is knowable only for a dictionary this plugin put there. A file
// dropped in by `npm run fetch-dict` has no version, and the `.dic` carries
// none, so "unknown" is a real state and must never be read as "outdated".
//
// Pure: no filesystem, no DOM, no native calls.

/** Where a native install has got to. */
export type InstallPhase = "verifying" | "extracting" | "swapping" | "loading";

import type { DictionaryFailure } from "./dictionarySource.ts";

/** What exists, from the two authorities that are not the user. */
export type DictionaryInventory = {
  /** On disk, per the directory listing. */
  readonly installed: boolean;
  /** The release on disk, when the plugin was the one that put it there. */
  readonly version: string | undefined;
  /**
   * The newest release a check has actually seen.
   *
   * Separate from `version`, which is what is on disk. Comparing the two is the
   * only way to say "an update exists" as a fact rather than as the residue of
   * a button somebody pressed: the row used to show "already the newest
   * release" on opening settings, having checked nothing itself.
   *
   * Undefined means "not asked", never "up to date".
   */
  readonly latest: string | undefined;
  /**
   * When that check happened, as an epoch millisecond.
   *
   * Persisted, so it outlives the panel and an NCM restart. It is what lets
   * "already the newest release" be a durable statement about a check that
   * really ran, rather than the residue of a 4s cooldown after a press — and it
   * is what stops the button asking again within `CHECK_INTERVAL_MS`.
   */
  readonly checkedAt: number | undefined;
};

/**
 * What an install is doing right now.
 *
 * Failure lives here rather than on the inventory, which is the whole point of
 * the split: a failed attempt says nothing about whether a dictionary exists,
 * and treating it as though it did is what silenced the lyrics-page notice.
 *
 * `at` is a timestamp so a cooldown can be a pure function of `(job, now)`
 * instead of a `setTimeout` the panel has to own and clean up.
 *
 * There is no success variant. "Already the newest release" was one until
 * 2026-08-07, which made a lasting answer out of a 4s window; it lives on the
 * inventory as `checkedAt` now, because it is a fact rather than an event.
 */
export type DictionaryJob =
  | { readonly kind: "idle" }
  /** `at` is when the check started, so the row can decline to flash a state nobody can read. */
  | { readonly kind: "resolving"; readonly at: number }
  | { readonly kind: "downloading"; readonly received: number; readonly total: number }
  | {
      readonly kind: "installing";
      readonly phase: InstallPhase;
      readonly done: number;
      /** Zero while the size is not knowable yet, which reads as indeterminate. */
      readonly total: number;
    }
  | { readonly kind: "failed"; readonly reason: DictionaryFailure; readonly at: number };


export type DictionarySettings = {
  readonly dictVersion: string | undefined;
  /**
   * Whether the first-run prompt has been answered.
   *
   * A plain flag, because there is only one dismissal. It used to record *how*
   * it was dismissed ("later" against "never"), and the two were then treated
   * identically by the only code that read it, so "Skip for now" and "Don't ask
   * again" did exactly the same thing while promising different things.
   *
   * Nothing re-raises this dialog. The reminder job belongs to the lyric-line
   * notice, which speaks when a Japanese line cannot be read and says where to
   * fix it, so a launch-time popup would only nag people who are not listening
   * to Japanese at all.
   */
  readonly dictSetupAnswered: boolean;
  /** When the last update check got a real answer; see `DictionaryInventory`. */
  readonly dictCheckedAt: number | undefined;
};

/**
 * Read the dictionary settings out of whatever localStorage holds.
 *
 * **Not a migration.** Nothing is released, so nothing needs backward
 * compatibility (hard rule 10). This exists because the blob is a file a human
 * can open and edit, and a malformed value must not stop the plugin loading:
 * every read falls back to a default rather than throwing. Guarding against
 * garbage is not compatibility.
 */
export function migrateDictionarySettings(raw: unknown): DictionarySettings {
  const source: Record<string, unknown> =
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const version = source.dictVersion;
  const checkedAt = source.dictCheckedAt;
  return {
    dictVersion: typeof version === "string" && version !== "" ? version : undefined,
    dictSetupAnswered: source.dictSetupAnswered === true,
    // A timestamp has to be a usable number or absent. NaN and Infinity both
    // survive a `typeof` check and would make every comparison against the
    // interval false, silently disabling the throttle they were read for.
    dictCheckedAt:
      typeof checkedAt === "number" && Number.isFinite(checkedAt) && checkedAt > 0
        ? checkedAt
        : undefined,
  };
}
