// Narrow client for the Rust-owned dictionary subsystem.

import type { DictionaryEdition } from "../engine/dictionarySource.ts";
import {
  parseDictionarySnapshot,
  type DictionaryErrorCode,
  type DictionarySnapshot,
} from "../engine/dictionaryState.ts";
import type { AnalyzerToken } from "../engine/tokens.ts";
import { log } from "./log.ts";

type NativeErrorCode = DictionaryErrorCode | "badCommand" | "analysisFailed" | "unavailable" | "invalidResponse";
type DispatchResponse =
  | { status: "ok"; data: unknown }
  | { status: "error"; errorCode: NativeErrorCode };
export type NativeResult<T> = { ok: true; value: T } | { ok: false; errorCode: NativeErrorCode };

function dispatch(command: Record<string, unknown>): NativeResult<unknown> {
  try {
    const raw = betterncm_native.native_plugin.call("kashiyomi.dispatch", [JSON.stringify(command)]);
    if (typeof raw !== "string" || raw === "") return { ok: false, errorCode: "unavailable" };
    const response = JSON.parse(raw) as DispatchResponse;
    if (response.status === "error") return { ok: false, errorCode: response.errorCode };
    if (response.status !== "ok") return { ok: false, errorCode: "invalidResponse" };
    return { ok: true, value: response.data };
  } catch (error) {
    log.debug("native dispatch failed", error);
    return { ok: false, errorCode: "unavailable" };
  }
}

function snapshot(command: Record<string, unknown>): NativeResult<DictionarySnapshot> {
  const response = dispatch(command);
  if (!response.ok) return response;
  const parsed = parseDictionarySnapshot(response.value);
  return parsed ? { ok: true, value: parsed } : { ok: false, errorCode: "invalidResponse" };
}

export function nativeConfigureDictionary(
  dataDir: string,
  resourceDir: string,
  legacyPreference: DictionaryEdition,
): NativeResult<DictionarySnapshot> {
  return snapshot({ cmd: "configureDictionary", dataDir, resourceDir, legacyPreference });
}

export function nativeDictionaryStatus(): NativeResult<DictionarySnapshot> {
  return snapshot({ cmd: "dictionaryStatus" });
}

function start(command: "dictionaryInstall" | "dictionaryActivate" | "dictionaryRemove", edition: DictionaryEdition): NativeResult<number> {
  const response = dispatch({ cmd: command, edition });
  if (!response.ok) return response;
  const operationId = (response.value as { operationId?: unknown } | null)?.operationId;
  return typeof operationId === "number" && Number.isSafeInteger(operationId) && operationId > 0
    ? { ok: true, value: operationId }
    : { ok: false, errorCode: "invalidResponse" };
}

export const nativeDictionaryInstall = (edition: DictionaryEdition): NativeResult<number> => start("dictionaryInstall", edition);
export const nativeDictionaryActivate = (edition: DictionaryEdition): NativeResult<number> => start("dictionaryActivate", edition);
export const nativeDictionaryRemove = (edition: DictionaryEdition): NativeResult<number> => start("dictionaryRemove", edition);

export function nativeDictionaryCancel(operationId: number): NativeResult<boolean> {
  const response = dispatch({ cmd: "dictionaryCancel", operationId });
  if (!response.ok) return response;
  const accepted = (response.value as { accepted?: unknown } | null)?.accepted;
  return typeof accepted === "boolean"
    ? { ok: true, value: accepted }
    : { ok: false, errorCode: "invalidResponse" };
}

export type AnalyzeResult =
  | { kind: "ready"; lines: AnalyzerToken[][] }
  | { kind: "pending" }
  | { kind: "unavailable"; error?: string };

export function nativeAnalyze(lines: readonly string[]): AnalyzeResult {
  const response = dispatch({ cmd: "analyze", lines });
  if (!response.ok) return { kind: "unavailable", error: response.errorCode };
  const data = response.value as { state?: unknown; lines?: unknown };
  if (data?.state === "ready" && Array.isArray(data.lines)) {
    return { kind: "ready", lines: data.lines as AnalyzerToken[][] };
  }
  if (data?.state === "loading" || data?.state === "uninitialized") return { kind: "pending" };
  return { kind: "unavailable", error: data?.state === "failed" ? "loadFailed" : "invalidResponse" };
}
