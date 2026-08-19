// Build-pinned dictionary release metadata. Runtime code never resolves a
// "latest" release; a Kashiyomi release changes this canonical manifest.

import rawManifest from "../../dictionary-releases.json" with { type: "json" };

export type DictionaryEdition = "core" | "full";
export const DICTIONARY_EDITIONS = ["core", "full"] as const;

export type DictionarySource = {
  readonly url: string;
  readonly archiveBytes: number;
  readonly archiveSha256: string;
  readonly member: string;
};

export type DictionaryRelease = {
  readonly version: string;
  readonly dictionaryBytes: number;
  readonly dictionarySha256: string;
  readonly sources: readonly DictionarySource[];
};

export type DictionaryReleaseManifest = {
  readonly schemaVersion: 1;
  readonly editions: Readonly<Record<DictionaryEdition, DictionaryRelease>>;
};

function validHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

export function parseReleaseManifest(value: unknown): DictionaryReleaseManifest | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const root = value as { schemaVersion?: unknown; editions?: unknown };
  if (root.schemaVersion !== 1 || typeof root.editions !== "object" || root.editions === null) {
    return undefined;
  }
  const editions = root.editions as Record<string, unknown>;
  for (const edition of DICTIONARY_EDITIONS) {
    const release = editions[edition] as Partial<DictionaryRelease> | undefined;
    if (
      !release ||
      typeof release.version !== "string" ||
      !Number.isSafeInteger(release.dictionaryBytes) ||
      Number(release.dictionaryBytes) <= 0 ||
      !validHash(release.dictionarySha256) ||
      !Array.isArray(release.sources) ||
      release.sources.length === 0
    ) return undefined;
    for (const source of release.sources) {
      if (
        typeof source !== "object" || source === null ||
        typeof source.url !== "string" || !source.url.startsWith("https://") ||
        !Number.isSafeInteger(source.archiveBytes) || Number(source.archiveBytes) <= 0 ||
        !validHash(source.archiveSha256) ||
        typeof source.member !== "string" || source.member === ""
      ) return undefined;
    }
  }
  return value as DictionaryReleaseManifest;
}

const parsed = parseReleaseManifest(rawManifest);
if (!parsed) throw new Error("invalid embedded dictionary release manifest");
export const DICTIONARY_RELEASES = parsed;

export function pinnedRelease(edition: DictionaryEdition): DictionaryRelease {
  return DICTIONARY_RELEASES.editions[edition];
}

/** Archive, extracted dictionary, and native transaction safety margin. */
export function requiredFreeBytes(edition: DictionaryEdition): number {
  const release = pinnedRelease(edition);
  const archive = Math.max(...release.sources.map((source) => source.archiveBytes));
  return archive + release.dictionaryBytes + 64 * 1024 * 1024;
}
