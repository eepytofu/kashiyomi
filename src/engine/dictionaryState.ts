import { DICTIONARY_EDITIONS, type DictionaryEdition } from "./dictionarySource.ts";

export type AnalyzerState = "uninitialized" | "loading" | "ready" | "failed";
export type OperationKind = "recover" | "install" | "activate" | "remove";
export type OperationState = "running" | "succeeded" | "failed" | "cancelled";
export type OperationPhase =
  | "starting" | "connecting" | "downloading" | "extracting"
  | "validating" | "activating" | "cleaning";
export type DictionaryErrorCode =
  | "notConfigured" | "busy" | "notInstalled" | "diskSpace" | "offline"
  | "http" | "archiveSize" | "archiveHash" | "archiveInvalid"
  | "dictionarySize" | "dictionaryHash" | "dictionaryMissing" | "loadFailed"
  | "deleteFailed" | "manifest" | "io" | "unsupported";

export type DictionaryOperation = {
  readonly id: number;
  readonly kind: OperationKind;
  readonly edition?: DictionaryEdition;
  readonly state: OperationState;
  readonly phase: OperationPhase;
  readonly done: number;
  readonly total: number;
  readonly cancellable: boolean;
  readonly errorCode?: DictionaryErrorCode;
};

export type InstalledDictionary = {
  readonly edition: DictionaryEdition;
  readonly version?: string;
  readonly dictionaryBytes: number;
  readonly active: boolean;
  readonly pinnedVersion: string;
  readonly updateAvailable: boolean;
};

export type DictionarySnapshot = {
  readonly configured: boolean;
  readonly installed: readonly InstalledDictionary[];
  readonly active?: DictionaryEdition;
  readonly freeBytes?: number;
  readonly operation?: DictionaryOperation;
  readonly analyzer: { readonly state: AnalyzerState };
};

const ANALYZER_STATES = ["uninitialized", "loading", "ready", "failed"] as const;
const OPERATION_KINDS = ["recover", "install", "activate", "remove"] as const;
const OPERATION_STATES = ["running", "succeeded", "failed", "cancelled"] as const;
const OPERATION_PHASES = ["starting", "connecting", "downloading", "extracting", "validating", "activating", "cleaning"] as const;
const ERROR_CODES = ["notConfigured", "busy", "notInstalled", "diskSpace", "offline", "http", "archiveSize", "archiveHash", "archiveInvalid", "dictionarySize", "dictionaryHash", "dictionaryMissing", "loadFailed", "deleteFailed", "manifest", "io", "unsupported"] as const;

function member<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && values.includes(value as T);
}
function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function edition(value: unknown): value is DictionaryEdition {
  return member(DICTIONARY_EDITIONS, value);
}

/** Reject malformed native snapshots rather than letting the UI invent state. */
export function parseDictionarySnapshot(value: unknown): DictionarySnapshot | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const root = value as { dictionary?: unknown; analyzer?: unknown };
  if (typeof root.dictionary !== "object" || root.dictionary === null || typeof root.analyzer !== "object" || root.analyzer === null) return undefined;
  const dictionary = root.dictionary as Record<string, unknown>;
  const analyzer = root.analyzer as Record<string, unknown>;
  if (typeof dictionary.configured !== "boolean" || !Array.isArray(dictionary.installed) || !member(ANALYZER_STATES, analyzer.state)) return undefined;
  if (dictionary.active !== null && dictionary.active !== undefined && !edition(dictionary.active)) return undefined;
  if (dictionary.freeBytes !== null && dictionary.freeBytes !== undefined && !count(dictionary.freeBytes)) return undefined;
  const installed: InstalledDictionary[] = [];
  const seen = new Set<DictionaryEdition>();
  for (const raw of dictionary.installed) {
    if (typeof raw !== "object" || raw === null) return undefined;
    const item = raw as Record<string, unknown>;
    if (!edition(item.edition) || seen.has(item.edition) || !count(item.dictionaryBytes) || typeof item.active !== "boolean" || typeof item.pinnedVersion !== "string" || typeof item.updateAvailable !== "boolean") return undefined;
    if (item.version !== null && item.version !== undefined && typeof item.version !== "string") return undefined;
    seen.add(item.edition);
    installed.push({ edition: item.edition, version: typeof item.version === "string" ? item.version : undefined, dictionaryBytes: item.dictionaryBytes, active: item.active, pinnedVersion: item.pinnedVersion, updateAvailable: item.updateAvailable });
  }
  let operation: DictionaryOperation | undefined;
  if (dictionary.operation !== null && dictionary.operation !== undefined) {
    if (typeof dictionary.operation !== "object") return undefined;
    const raw = dictionary.operation as Record<string, unknown>;
    if (!count(raw.id) || !member(OPERATION_KINDS, raw.kind) || !member(OPERATION_STATES, raw.state) || !member(OPERATION_PHASES, raw.phase) || !count(raw.done) || !count(raw.total) || typeof raw.cancellable !== "boolean") return undefined;
    if (raw.edition !== null && raw.edition !== undefined && !edition(raw.edition)) return undefined;
    if (raw.errorCode !== null && raw.errorCode !== undefined && !member(ERROR_CODES, raw.errorCode)) return undefined;
    operation = { id: raw.id, kind: raw.kind, edition: edition(raw.edition) ? raw.edition : undefined, state: raw.state, phase: raw.phase, done: raw.done, total: raw.total, cancellable: raw.cancellable, errorCode: member(ERROR_CODES, raw.errorCode) ? raw.errorCode : undefined };
  }
  return { configured: dictionary.configured, installed, active: edition(dictionary.active) ? dictionary.active : undefined, freeBytes: count(dictionary.freeBytes) ? dictionary.freeBytes : undefined, operation, analyzer: { state: analyzer.state } };
}

export function installedEdition(snapshot: DictionarySnapshot, edition: DictionaryEdition): InstalledDictionary | undefined {
  return snapshot.installed.find((entry) => entry.edition === edition);
}

export type EditionViewState = "in-use" | "installed" | "not-installed" | "update-available";
export function editionViewState(snapshot: DictionarySnapshot, target: DictionaryEdition): EditionViewState {
  const found = installedEdition(snapshot, target);
  if (!found) return "not-installed";
  if (found.updateAvailable) return "update-available";
  return snapshot.active === target ? "in-use" : "installed";
}

export function fallbackEdition(snapshot: DictionarySnapshot, removing: DictionaryEdition): DictionaryEdition | undefined {
  return snapshot.installed.find((entry) => entry.edition !== removing)?.edition;
}
