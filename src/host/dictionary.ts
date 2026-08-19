// Browser-side observer for the native-owned dictionary snapshot. It owns no
// release resolution, transfer state, filesystem path, or success inference.

import type { DictionaryEdition } from "../engine/dictionarySource.ts";
import type { DictionaryErrorCode, DictionarySnapshot } from "../engine/dictionaryState.ts";
import {
  nativeConfigureDictionary,
  nativeDictionaryActivate,
  nativeDictionaryCancel,
  nativeDictionaryInstall,
  nativeDictionaryRemove,
  nativeDictionaryStatus,
  type NativeResult,
} from "./native.ts";
import { log } from "./log.ts";

const EMPTY: DictionarySnapshot = {
  configured: false,
  installed: [],
  analyzer: { state: "uninitialized" },
};

let current = EMPTY;
let pollTimer: number | undefined;
const listeners = new Set<() => void>();

export function dictionarySnapshot(): DictionarySnapshot {
  return current;
}

export function dictionaryAvailable(): boolean {
  return current.active !== undefined && current.analyzer.state === "ready";
}

export function onDictionaryChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(snapshot: DictionarySnapshot): void {
  current = snapshot;
  for (const listener of listeners) listener();
  if (snapshot.operation?.state === "running") startPolling();
  else stopPolling();
}

function refresh(): void {
  const result = nativeDictionaryStatus();
  if (result.ok) publish(result.value);
  else log.warn("dictionary status unavailable", result.errorCode);
}

function startPolling(): void {
  if (pollTimer !== undefined) return;
  pollTimer = window.setInterval(refresh, 250);
}

function stopPolling(): void {
  if (pollTimer === undefined) return;
  window.clearInterval(pollTimer);
  pollTimer = undefined;
}

export function configureDictionary(
  dataDir: string,
  resourceDir: string,
  legacyPreference: DictionaryEdition,
): NativeResult<DictionarySnapshot> {
  const result = nativeConfigureDictionary(dataDir, resourceDir, legacyPreference);
  if (result.ok) publish(result.value);
  return result;
}

export function waitForDictionaryRecovery(): Promise<DictionarySnapshot> {
  if (current.operation?.kind !== "recover" || current.operation.state !== "running") {
    return Promise.resolve(current);
  }
  return new Promise((resolve) => {
    const unsubscribe = onDictionaryChange(() => {
      if (current.operation?.kind === "recover" && current.operation.state === "running") return;
      unsubscribe();
      resolve(current);
    });
  });
}

function start(action: (edition: DictionaryEdition) => NativeResult<number>, edition: DictionaryEdition): NativeResult<number> {
  const result = action(edition);
  if (result.ok) {
    refresh();
    startPolling();
  }
  return result;
}

export const installDictionary = (edition: DictionaryEdition): NativeResult<number> => start(nativeDictionaryInstall, edition);
export const activateDictionary = (edition: DictionaryEdition): NativeResult<number> => start(nativeDictionaryActivate, edition);
export const removeDictionary = (edition: DictionaryEdition): NativeResult<number> => start(nativeDictionaryRemove, edition);

export function cancelDictionary(operationId: number): NativeResult<boolean> {
  const result = nativeDictionaryCancel(operationId);
  if (result.ok && result.value) startPolling();
  return result;
}

export function lastDictionaryError(): DictionaryErrorCode | undefined {
  const operation = current.operation;
  return operation?.state === "failed" ? operation.errorCode : undefined;
}

export function dictionaryListenerCount(): number {
  return listeners.size;
}
