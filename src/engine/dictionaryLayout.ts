// Where the dictionary lives on disk.

/** The installed dictionary. */
export const DICTIONARY_FILE = "system_core.dic";

export function dictionaryPath(directory: string): string {
  return `${stripTrailingSlash(directory)}/${DICTIONARY_FILE}`;
}

/** Whether a directory listing contains the dictionary. */
export function hasDictionary(names: readonly string[]): boolean {
  return names.some((name) => baseName(name) === DICTIONARY_FILE);
}

/** Where a download is staged. */
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
