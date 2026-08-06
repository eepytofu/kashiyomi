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

export type InstallResult = { ok: true; started: boolean } | { ok: false; error: string };

/** What the worker thread is doing, or how it finished. */
export type NativeInstallJob =
  | { kind: "idle" }
  | { kind: "running"; phase: "verifying" | "extracting" | "swapping" | "loading"; done: number; total: number }
  | { kind: "done"; bytes: number; started: boolean }
  | { kind: "failed"; message: string }
  | { kind: "cancelled" };

/**
 * Ask a running install to stop, and report whether it agreed to.
 *
 * False means the worker is past the swap. By then the old dictionary is
 * unloaded and the rename may have landed, so stopping would leave the analyzer
 * closed over a half-replaced file. The row disables Cancel through those
 * phases, so a refusal should not normally be reachable from the panel.
 */
export function nativeCancelInstall(): boolean {
  const response = dispatch({ cmd: "cancelInstall" });
  if (!response || response.status === "error") return false;
  return (response.data as { accepted?: boolean }).accepted === true;
}

export type NativeDictStatus = {
  analyzer: { state: NativeState; error?: string };
  job: NativeInstallJob;
};

/**
 * Analyzer state and install progress in one call.
 *
 * Polled while an install runs, which is the only reason it exists: the work
 * moved to a worker thread, so its result no longer comes back as the return
 * value of the call that started it.
 */
export function nativeDictStatus(): NativeDictStatus | undefined {
  const response = dispatch({ cmd: "dictStatus" });
  if (!response || response.status === "error") return undefined;
  const data = response.data as { analyzer?: { state: NativeState; error?: string }; job?: NativeInstallJob };
  if (!data.analyzer || !data.job) return undefined;
  return { analyzer: data.analyzer, job: data.job };
}

/**
 * Start verifying and installing a downloaded archive, and return at once.
 *
 * The fetch happens in JS because `fetch` is already HTTPS, already streams and
 * already honours the user's proxy. Everything after it happens natively,
 * because extraction produces 207 MB and that must not exist in this heap.
 *
 * **Asynchronous.** Hashing up to 121 MB and extracting 207 MB used to run on
 * the renderer thread, freezing NCM's entire UI for seconds with nothing on
 * screen to explain it. `started: false` means a job was already running, which
 * is a refusal rather than a failure.
 *
 * The load is not a separate call any more. Installing closes the dictionary in
 * order to replace it, so a caller that installed and then failed to reload
 * would leave the analyzer shut — and the host cannot close it itself, which is
 * how the unload and the rename ended up in the wrong order to begin with.
 *
 * `superseded` is a dictionary this one replaces (switching edition). The
 * backend deletes it only once the new one has loaded, so a failed load still
 * leaves a working dictionary on the machine.
 *
 * `sha256` is the value pinned at build time. A failure here always leaves the
 * previous dictionary untouched.
 */
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
 * asked. Checked before a download starts: extraction needs ~207 MB on top of
 * the 69 MB archive, so a disk that cannot hold both should fail before the
 * bandwidth is spent rather than after.
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
