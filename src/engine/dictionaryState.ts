// Three facts about the dictionary, kept apart because one field could not
// answer all three.

/** Where a native install has got to. */
export type InstallPhase = "verifying" | "extracting" | "swapping" | "loading";

import type { DictionaryFailure } from "./dictionarySource.ts";

/** What exists, from the two authorities that are not the user. */
export type DictionaryInventory = {
  /** On disk, per the directory listing. */
  readonly installed: boolean;
  /** The release on disk, when the plugin was the one that put it there. */
  readonly version: string | undefined;
  /** The newest release a check has actually seen. */
  readonly latest: string | undefined;
  /** When that check happened, as an epoch millisecond. */
  readonly checkedAt: number | undefined;
};

/** What an install is doing right now. */
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
  /** Whether the first-run prompt has been answered. */
  readonly dictSetupAnswered: boolean;
  /** When the last update check got a real answer; see `DictionaryInventory`. */
  readonly dictCheckedAt: number | undefined;
};

/** Read the dictionary settings out of whatever localStorage holds. */
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
