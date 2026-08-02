// Console logging with one prefix, gated by the debug setting. Everything is
// also mirrored to a log file in the BetterNCM data folder so problems can be
// diagnosed without the in-app console.

import { getSettings } from "./settings.ts";

const PREFIX = "[Kashiyomi]";
const MAX_BUFFER_LINES = 800;

let buffer: string[] = [];
let flushTimer: number | undefined;
let logFilePath: string | undefined;

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function record(level: string, args: readonly unknown[]): void {
  const time = new Date().toISOString().slice(11, 23);
  buffer.push(`${time} ${level} ${args.map(stringify).join(" ")}`);
  if (buffer.length > MAX_BUFFER_LINES) buffer = buffer.slice(-MAX_BUFFER_LINES);
  scheduleFlush();
}

function scheduleFlush(): void {
  if (flushTimer !== undefined) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = undefined;
    void flush();
  }, 800);
}

async function flush(): Promise<void> {
  try {
    if (!logFilePath) {
      const dataPath = await betterncm.app.getDataPath();
      logFilePath = `${dataPath}/kashiyomi.log`;
    }
    await betterncm.fs.writeFileText(logFilePath, buffer.join("\n") + "\n");
  } catch {
    // File logging is best-effort; the console still has everything.
  }
}

export const log = {
  info(...args: unknown[]): void {
    console.log(PREFIX, ...args);
    record("INFO", args);
  },
  warn(...args: unknown[]): void {
    console.warn(PREFIX, ...args);
    record("WARN", args);
  },
  debug(...args: unknown[]): void {
    if (getSettings().debug) console.log(PREFIX, ...args);
    record("DEBUG", args);
  },
};
