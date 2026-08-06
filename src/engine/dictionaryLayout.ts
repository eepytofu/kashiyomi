// Where dictionary files live on disk, and which one to load at startup.
//
// This convention was derived independently in four places — the default asset
// path, the download planner, and two callers slicing a directory back out of a
// file path — and they did not agree. The default hardcoded `system_core.dic`
// while downloads wrote `system_<edition>.dic`, so installing `small` worked
// until the next restart and then loaded nothing: the row said small, the
// analyzer had opened a file that was not there.
//
// Pure: no filesystem. The host supplies a directory listing and acts on the
// answer, so every rule below is covered by `node --test`.

import { DICTIONARY_EDITIONS, type DictionaryEdition } from "./dictionarySource.ts";

/** The installed dictionary for an edition. Editions coexist; nothing is shared. */
export function dictionaryFileName(edition: DictionaryEdition): string {
  return `system_${edition}.dic`;
}

export function dictionaryPath(directory: string, edition: DictionaryEdition): string {
  return `${stripTrailingSlash(directory)}/${dictionaryFileName(edition)}`;
}

/**
 * The edition a file holds, or undefined when the name is not one of ours.
 *
 * Accepts a bare name or a full path, because a directory listing may return
 * either and a caller that has to normalise first would be a fifth copy of the
 * convention this module exists to hold.
 */
export function editionFromFileName(name: string): DictionaryEdition | undefined {
  const base = baseName(name);
  return DICTIONARY_EDITIONS.find((edition) => dictionaryFileName(edition) === base);
}

/**
 * Where a download is staged.
 *
 * The `.part` suffix is load-bearing, not decoration: the startup sweeper finds
 * abandoned downloads by that extension alone. Archives were written as plain
 * `.whl`, so a transfer killed mid-flight stranded ~69 MB that nothing ever
 * collected — us causing the full disk we otherwise report politely.
 */
export function archiveFileName(edition: DictionaryEdition, version: string): string {
  return `sudachidict_${edition}-${version}.whl.part`;
}

export function archivePath(
  directory: string,
  edition: DictionaryEdition,
  version: string,
): string {
  return `${stripTrailingSlash(directory)}/${archiveFileName(edition, version)}`;
}

/**
 * Which editions a directory listing actually contains.
 *
 * The disk is the authority on this. It used to be answered from settings,
 * which records what the user *wants* — so a failed or interrupted install left
 * the row confidently describing a file that was never written.
 *
 * Returned in `DICTIONARY_EDITIONS` order rather than directory order, so the
 * result does not depend on how a filesystem chose to enumerate.
 */
export function installedEditionsFrom(names: readonly string[]): readonly DictionaryEdition[] {
  const present = new Set<DictionaryEdition>();
  for (const name of names) {
    const edition = editionFromFileName(name);
    if (edition) present.add(edition);
  }
  return DICTIONARY_EDITIONS.filter((edition) => present.has(edition));
}

export type BootChoice = {
  /** The edition to hand the analyzer, or undefined when there is nothing to load. */
  readonly load: DictionaryEdition | undefined;
  /** Editions safe to delete: superseded by the one being loaded. */
  readonly deletable: readonly DictionaryEdition[];
};

/**
 * Decide what to load at startup from what is on disk and what the user chose.
 *
 * **Never rewrites the preference.** Booting used to reconcile the two by
 * making settings agree with the disk, which quietly turned "I want core, and
 * the download failed" into "I want small" — the user's choice overwritten by
 * an accident, with no way to notice it had happened.
 *
 * So the preference and the disk are allowed to disagree, and the row reports
 * the disagreement (a Switch is pending) instead of resolving it silently.
 * Nothing is deleted unless the preferred edition is present, because deleting
 * the only dictionary a machine has in order to honour a preference nothing has
 * yet satisfied would leave it with no readings at all.
 */
export function chooseBootEdition(
  preferred: DictionaryEdition,
  installed: readonly DictionaryEdition[],
): BootChoice {
  const present = DICTIONARY_EDITIONS.filter((edition) => installed.includes(edition));
  if (present.length === 0) return { load: undefined, deletable: [] };
  if (present.includes(preferred)) {
    return { load: preferred, deletable: present.filter((edition) => edition !== preferred) };
  }
  // The preference is not satisfied yet. Load what exists so the plugin works,
  // and keep it: it is the only dictionary here.
  return { load: present[0]!, deletable: [] };
}

function baseName(name: string): string {
  const cut = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  return cut === -1 ? name : name.slice(cut + 1);
}

function stripTrailingSlash(directory: string): string {
  return directory.endsWith("/") || directory.endsWith("\\")
    ? directory.slice(0, -1)
    : directory;
}
