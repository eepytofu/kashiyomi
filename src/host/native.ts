// Client for the Rust backend registered as kashiyomi.dispatch.
// All calls are synchronous JSON-string in/out; the DLL keeps them cheap.

import type { AnalyzerToken } from "../engine/tokens.ts";
import { log } from "./log.ts";

export type NativeState = "unavailable" | "uninitialized" | "loading" | "ready" | "failed";

type DispatchResponse =
  | { status: "ok"; data: Record<string, unknown> }
  | { status: "error"; message: string };

function dispatch(command: Record<string, unknown>): DispatchResponse | undefined {
  try {
    const raw = betterncm_native.native_plugin.call("kashiyomi.dispatch", [JSON.stringify(command)]);
    if (typeof raw !== "string" || raw === "") return undefined;
    return JSON.parse(raw) as DispatchResponse;
  } catch (err) {
    log.debug("native dispatch failed", err);
    return undefined;
  }
}

export function nativeState(): { state: NativeState; error?: string } {
  const response = dispatch({ cmd: "status" });
  if (!response) return { state: "unavailable" };
  if (response.status === "error") return { state: "failed", error: response.message };
  const data = response.data as { state?: string; error?: string };
  switch (data.state) {
    case "uninitialized":
    case "loading":
    case "ready":
    case "failed":
      return { state: data.state, error: data.error };
    default:
      return { state: "unavailable" };
  }
}

export function nativeInit(dictPath: string, resourceDir: string): void {
  dispatch({ cmd: "init", dictPath, resourceDir });
}

/**
 * Load a different dictionary in place of the one already in memory.
 *
 * `nativeInit` cannot do this — it returns early once a dictionary is loaded,
 * which is right for an idempotent startup call and useless for switching
 * edition. Returns false when the backend declined because a load was already
 * running, so the caller can retry rather than race it.
 */
export function nativeReload(dictPath: string, resourceDir: string): boolean {
  const response = dispatch({ cmd: "reload", dictPath, resourceDir });
  if (!response || response.status === "error") return false;
  return (response.data as { started?: boolean }).started === true;
}

export type InstallResult = { ok: true; bytes: number } | { ok: false; error: string };

/**
 * Hand a downloaded archive to the backend to verify and install.
 *
 * The fetch happens in JS because `fetch` is already HTTPS, already streams and
 * already honours the user's proxy. Everything after it happens natively,
 * because extraction produces 207 MB and that must not exist in this heap.
 *
 * `sha256` is the value pinned at build time. A failure here always leaves the
 * previous dictionary untouched.
 */
export function nativeInstallDictionary(
  archive: string,
  sha256: string,
  member: string,
  target: string,
): InstallResult {
  const response = dispatch({ cmd: "install", archive, sha256, member, target });
  if (!response) return { ok: false, error: "the analyzer backend is unavailable" };
  if (response.status === "error") return { ok: false, error: response.message };
  return { ok: true, bytes: Number((response.data as { bytes?: number }).bytes ?? 0) };
}

/**
 * Delete `.part` files left by an interrupted download. Called at startup: a
 * kill mid-download otherwise strands ~69 MB on a disk the user may already be
 * short of, which would make us the cause of the problem we take care to report.
 */
export function nativeSweepPartials(directory: string): number {
  const response = dispatch({ cmd: "sweepPartials", directory });
  if (!response || response.status === "error") return 0;
  return Number((response.data as { removed?: number }).removed ?? 0);
}

export type AnalyzeResult =
  | { kind: "ready"; lines: AnalyzerToken[][] }
  | { kind: "pending" }
  | { kind: "unavailable"; error?: string };

export function nativeAnalyze(lines: readonly string[]): AnalyzeResult {
  const response = dispatch({ cmd: "analyze", lines });
  if (!response) return { kind: "unavailable" };
  if (response.status === "error") return { kind: "unavailable", error: response.message };
  const data = response.data as { state?: string; lines?: AnalyzerToken[][]; error?: string };
  if (data.state === "ready" && Array.isArray(data.lines)) {
    return { kind: "ready", lines: data.lines };
  }
  if (data.state === "loading" || data.state === "uninitialized") return { kind: "pending" };
  return { kind: "unavailable", error: data.error };
}
