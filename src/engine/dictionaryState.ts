// Three facts about the dictionary, kept apart because one field could not
// answer all three.
//
// `dictEdition` meant "installed" and "wanted" at the same time, so a switch
// that failed left settings naming a file that was never written. The single
// `status` field collapsed the same way in the other direction: a failed
// attempt stayed `failed` until the next launch, and the lyrics-page notice
// asks that field whether a dictionary exists, so the machines with no
// dictionary and one failed download were exactly the ones told nothing.
//
// Authority per fact, and none of the three can answer for another:
//
//   what is installed  -> the disk (a directory listing)
//   what is loaded     -> the analyzer
//   what is wanted     -> settings
//
// Pure: no filesystem, no DOM, no native calls.

import {
  DICTIONARY_EDITIONS,
  type DictionaryEdition,
  type DictionaryFailure,
} from "./dictionarySource.ts";

/** Release date per edition, e.g. `{ core: "20260723" }`. */
export type DictionaryVersions = { readonly [E in DictionaryEdition]?: string };

/** A writable shape for building one; the exported type stays readonly. */
type MutableVersions = { -readonly [E in DictionaryEdition]?: string };

/**
 * Where a native install has got to.
 *
 * Reported per phase because they behave differently, not for decoration:
 * verifying and extracting are long, measurable and safe to abandon, while
 * swapping and loading are neither long nor safe to interrupt.
 */
export type InstallPhase = "verifying" | "extracting" | "swapping" | "loading";

/** What exists, from the two authorities that are not the user. */
export type DictionaryInventory = {
  readonly installed: readonly DictionaryEdition[];
  readonly versions: DictionaryVersions;
  readonly loaded: DictionaryEdition | undefined;
};

/**
 * What an install is doing right now.
 *
 * Failure lives here rather than on the inventory, which is the whole point of
 * the split: a failed attempt says nothing about whether a dictionary exists,
 * and treating it as though it did is what silenced the notice.
 *
 * `at` is a timestamp so a cooldown can be a pure function of `(job, now)`
 * instead of a `setTimeout` the panel has to own and clean up.
 */
export type DictionaryJob =
  | { readonly kind: "idle" }
  | { readonly kind: "resolving"; readonly edition: DictionaryEdition }
  | {
      readonly kind: "downloading";
      readonly edition: DictionaryEdition;
      readonly received: number;
      readonly total: number;
    }
  | {
      readonly kind: "installing";
      readonly edition: DictionaryEdition;
      readonly phase: InstallPhase;
      readonly done: number;
      /** Zero while the size is not knowable yet, which reads as indeterminate. */
      readonly total: number;
    }
  | {
      readonly kind: "failed";
      readonly edition: DictionaryEdition;
      readonly reason: DictionaryFailure;
      readonly at: number;
    }
  | { readonly kind: "upToDate"; readonly edition: DictionaryEdition; readonly at: number };

/** Whether the first-run setup has been answered, and how. */
export type DictionarySetupSeen = "" | "later" | "never" | "done";

const SETUP_SEEN: readonly DictionarySetupSeen[] = ["", "later", "never", "done"];

export type DictionarySettings = {
  readonly dictPreferredEdition: DictionaryEdition;
  readonly dictVersions: DictionaryVersions;
  readonly dictSetupSeen: DictionarySetupSeen;
};

/**
 * Read the dictionary settings out of whatever localStorage holds.
 *
 * A pure function over the raw blob rather than a branch inside `getSettings`,
 * so every migration path below is covered by `node --test` instead of only
 * running on installs that happen to be old.
 *
 * Unknown values fall back to the default rather than throwing: this runs on
 * every settings read, and a blob edited by hand must not be able to stop the
 * plugin loading.
 */
export function migrateDictionarySettings(raw: unknown): DictionarySettings {
  const source: Record<string, unknown> =
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    dictPreferredEdition:
      asEdition(source.dictPreferredEdition) ?? asEdition(source.dictEdition) ?? "core",
    dictVersions: readVersions(source),
    dictSetupSeen: SETUP_SEEN.find((seen) => seen === source.dictSetupSeen) ?? "",
  };
}

function readVersions(source: Record<string, unknown>): DictionaryVersions {
  const stored: unknown = source.dictVersions;
  if (typeof stored === "object" && stored !== null) {
    const record = stored as Record<string, unknown>;
    const out: MutableVersions = {};
    for (const edition of DICTIONARY_EDITIONS) {
      const version: unknown = record[edition];
      if (typeof version === "string" && version !== "") out[edition] = version;
    }
    return out;
  }
  // Legacy shape: one version string belonging to whichever edition the old
  // single field named. Dropping it would cost a 69 MB re-download to learn a
  // date already sitting on the disk.
  const legacy: unknown = source.dictVersion;
  const edition = asEdition(source.dictEdition);
  if (typeof legacy === "string" && legacy !== "" && edition !== undefined) {
    const out: MutableVersions = {};
    out[edition] = legacy;
    return out;
  }
  return {};
}

/**
 * Drop version entries for editions that are not on disk.
 *
 * A version describes a file. Deleting the file by hand and keeping the date
 * leaves the row able to claim a release for something nothing can open, which
 * is the same class of lie the inventory split exists to end.
 */
export function pruneVersions(
  versions: DictionaryVersions,
  installed: readonly DictionaryEdition[],
): DictionaryVersions {
  const out: MutableVersions = {};
  for (const edition of DICTIONARY_EDITIONS) {
    if (!installed.includes(edition)) continue;
    const version = versions[edition];
    if (version !== undefined) out[edition] = version;
  }
  return out;
}

/** Record the release that just landed, leaving the other editions alone. */
export function withVersion(
  versions: DictionaryVersions,
  edition: DictionaryEdition,
  version: string,
): DictionaryVersions {
  const out: MutableVersions = {};
  for (const key of DICTIONARY_EDITIONS) {
    const existing = versions[key];
    if (existing !== undefined) out[key] = existing;
  }
  out[edition] = version;
  return out;
}

/**
 * Whether the user's choice is waiting on a download.
 *
 * The preference and the disk are allowed to disagree, because booting used to
 * resolve the disagreement by overwriting the preference. The row reports it
 * instead, which needs this to be askable rather than inferred from a status
 * string that no longer carries both facts.
 */
export function switchPending(
  preferred: DictionaryEdition,
  inventory: DictionaryInventory,
): boolean {
  return inventory.installed.length > 0 && !inventory.installed.includes(preferred);
}

function asEdition(value: unknown): DictionaryEdition | undefined {
  return DICTIONARY_EDITIONS.find((edition) => edition === value);
}
