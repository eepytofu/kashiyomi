// Console logging with one prefix, gated by the debug setting.

import { getSettings } from "./settings.ts";

const PREFIX = "[Kashiyomi]";

export const log = {
  info(...args: unknown[]): void {
    console.log(PREFIX, ...args);
  },
  warn(...args: unknown[]): void {
    console.warn(PREFIX, ...args);
  },
  debug(...args: unknown[]): void {
    if (getSettings().debug) console.log(PREFIX, ...args);
  },
};
