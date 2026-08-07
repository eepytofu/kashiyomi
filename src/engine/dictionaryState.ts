// Three facts about the dictionary, kept apart because one field could not
// answer all three.
//
// Authority per fact, and none of the three can answer for another:
//
//   whether it is installed  -> the disk (a directory listing)
//   whether it is loaded     -> the analyzer
//   which release it is      -> recorded when the plugin installed it
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
  /** Open in the analyzer. False while it is still loading, or failed to. */
  readonly loaded: boolean;
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
 */
export type DictionaryJob =
  | { readonly kind: "idle" }
  | { readonly kind: "resolving" }
  | { readonly kind: "downloading"; readonly received: number; readonly total: number }
  | {
      readonly kind: "installing";
      readonly phase: InstallPhase;
      readonly done: number;
      /** Zero while the size is not knowable yet, which reads as indeterminate. */
      readonly total: number;
    }
  | { readonly kind: "failed"; readonly reason: DictionaryFailure; readonly at: number }
  | { readonly kind: "upToDate"; readonly at: number };

/** Whether the first-run prompt has been answered, and how. */
export type DictionarySetupSeen = "" | "later" | "never" | "done";

const SETUP_SEEN: readonly DictionarySetupSeen[] = ["", "later", "never", "done"];

export type DictionarySettings = {
  readonly dictVersion: string | undefined;
  readonly dictSetupSeen: DictionarySetupSeen;
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
  return {
    dictVersion: typeof version === "string" && version !== "" ? version : undefined,
    dictSetupSeen: SETUP_SEEN.find((seen) => seen === source.dictSetupSeen) ?? "",
  };
}
