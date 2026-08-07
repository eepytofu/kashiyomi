// Where the dictionary lives on disk.
//
// One file, one name. The convention was previously derived independently in
// four places and they did not agree: the default hardcoded `system_core.dic`
// while downloads wrote `system_<edition>.dic`, so installing `small` worked
// until the next restart and then loaded nothing. Collapsing to one edition
// removes the disagreement rather than reconciling it.
//
// Pure: no filesystem. The host asks the disk and passes the answer in, so
// every rule here is covered by `node --test`.

/**
 * The installed dictionary.
 *
 * `core` is in the name because that is what SudachiDict calls the edition, and
 * because the analyze CLI can be pointed at `system_full.dic` beside it for
 * comparison work. The plugin only ever opens this one.
 */
export const DICTIONARY_FILE = "system_core.dic";

export function dictionaryPath(directory: string): string {
  return `${stripTrailingSlash(directory)}/${DICTIONARY_FILE}`;
}

/** Whether a directory listing contains the dictionary. */
export function hasDictionary(names: readonly string[]): boolean {
  return names.some((name) => baseName(name) === DICTIONARY_FILE);
}

/**
 * Where a download is staged.
 *
 * The `.part` suffix is load-bearing, not decoration: the startup sweeper finds
 * abandoned downloads by that extension alone. Archives were written as plain
 * `.whl`, so a transfer killed mid-flight stranded ~69 MB that nothing ever
 * collected, making the plugin the cause of the full disk it otherwise reports
 * politely.
 */
export function archiveFileName(version: string): string {
  return `sudachidict_core-${version}.whl.part`;
}

export function archivePath(directory: string, version: string): string {
  return `${stripTrailingSlash(directory)}/${archiveFileName(version)}`;
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
