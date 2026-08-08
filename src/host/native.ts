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

/** Load a different dictionary in place of the one already in memory. */
export function nativeReload(dictPath: string, resourceDir: string): boolean {
  const response = dispatch({ cmd: "reload", dictPath, resourceDir });
  if (!response || response.status === "error") return false;
  return (response.data as { started?: boolean }).started === true;
}

export type InstallResult = { ok: true; started: boolean } | { ok: false; error: string };

/** What the worker thread is doing, or how it finished. */
export type NativeInstallJob =
  | { kind: "idle" }
  | { kind: "running"; phase: "verifying" | "extracting" | "swapping" | "loading"; done: number; total: number }
  | { kind: "done"; bytes: number; started: boolean }
  | { kind: "failed"; message: string }
  | { kind: "cancelled" };

/** Ask a running install to stop, and report whether it agreed to. */
export function nativeCancelInstall(): boolean {
  const response = dispatch({ cmd: "cancelInstall" });
  if (!response || response.status === "error") return false;
  return (response.data as { accepted?: boolean }).accepted === true;
}

export type NativeDictStatus = {
  analyzer: { state: NativeState; error?: string };
  job: NativeInstallJob;
};

/** Analyzer state and install progress in one call. */
export function nativeDictStatus(): NativeDictStatus | undefined {
  const response = dispatch({ cmd: "dictStatus" });
  if (!response || response.status === "error") return undefined;
  const data = response.data as { analyzer?: { state: NativeState; error?: string }; job?: NativeInstallJob };
  if (!data.analyzer || !data.job) return undefined;
  return { analyzer: data.analyzer, job: data.job };
}

/** Start verifying and installing a downloaded archive, and return at once. */
export function nativeStartInstall(
  archive: string,
  sha256: string,
  member: string,
  target: string,
  resourceDir: string,
  superseded?: string,
): InstallResult {
  const response = dispatch({
    cmd: "install",
    archive,
    sha256,
    member,
    target,
    resourceDir,
    superseded: superseded ?? null,
  });
  if (!response) return { ok: false, error: "the analyzer backend is unavailable" };
  if (response.status === "error") return { ok: false, error: response.message };
  const data = response.data as { started?: boolean };
  return { ok: true, started: data.started === true };
}

/**
 * Bytes free on the volume holding `directory`, or undefined if it cannot be
 */
export function nativeFreeSpace(directory: string): number | undefined {
  const response = dispatch({ cmd: "freeSpace", directory });
  if (!response || response.status === "error") return undefined;
  const bytes = (response.data as { bytes?: number | null }).bytes;
  return typeof bytes === "number" ? bytes : undefined;
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
