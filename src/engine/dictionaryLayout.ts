// Where the dictionary lives on disk.

import { DICTIONARY_EDITIONS, type DictionaryEdition } from "./dictionarySource.ts";

export function dictionaryFileName(edition: DictionaryEdition): string {
  return `system_${edition}.dic`;
}

export function dictionaryPath(directory: string, edition: DictionaryEdition): string {
  return `${stripTrailingSlash(directory)}/${dictionaryFileName(edition)}`;
}

export function editionFromFileName(name: string): DictionaryEdition | undefined {
  const base = baseName(name);
  return DICTIONARY_EDITIONS.find((edition) => dictionaryFileName(edition) === base);
}

/** Editions physically present, in stable default-first order. */
export function installedEditionsFrom(names: readonly string[]): readonly DictionaryEdition[] {
  const present = new Set(names.map(editionFromFileName).filter(Boolean));
  return DICTIONARY_EDITIONS.filter((edition) => present.has(edition));
}

/** Prefer the recorded active edition, but always load a usable file if one exists. */
export function chooseBootEdition(
  active: DictionaryEdition,
  installed: readonly DictionaryEdition[],
): DictionaryEdition | undefined {
  if (installed.includes(active)) return active;
  return DICTIONARY_EDITIONS.find((edition) => installed.includes(edition));
}

/** Where a download is staged. */
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

function baseName(name: string): string {
  const cut = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  return cut === -1 ? name : name.slice(cut + 1);
}

function stripTrailingSlash(directory: string): string {
  return directory.endsWith("/") || directory.endsWith("\\")
    ? directory.slice(0, -1)
    : directory;
}
