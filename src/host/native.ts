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
