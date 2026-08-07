// Turning the dictionary view model into words.
//
// Shared by the settings row and the setup dialog. They show the same states in
// different containers, and the requirement is explicit: one source, or the two
// drift. `dictionaryRowState` decides, this says it, and neither knows what DOM
// it ends up in.

import { panelLang, t, tNoSpace } from "./i18n.ts";
import type { RowAction, RowMessage } from "../engine/dictionaryRowState.ts";

const MEGABYTE = 1024 * 1024;
const GIGABYTE = 1024 * MEGABYTE;

/** Download and requirement sizes, which are always in the tens or hundreds. */
export const mb = (bytes: number): string => `${(bytes / MEGABYTE).toFixed(1)} MB`;

/**
 * A size that could be anything, in whichever unit a person would use.
 *
 * Free space is the case: a healthy disk reads "26991.0 MB" through `mb`, which
 * is a number nobody writes and takes a moment to even parse as ~26 GB.
 */
export const size = (bytes: number): string =>
  bytes >= GIGABYTE ? `${(bytes / GIGABYTE).toFixed(1)} GB` : mb(bytes);

/**
 * SudachiDict versions are release dates as `20260723`. Formatted per panel
 * language, because the two do not agree and neither is "the superior format":
 *
 *   - Chinese and Japanese are **year first**, 2026年7月23日. That is not a
 *     preference, it is the word order (年月日), and GB/T 7408 follows ISO 8601.
 *   - Indonesian and most of Europe are day first, 23/07/2026. English is split,
 *     since the US puts the month first, so day-first is the safer default for
 *     the English panel.
 *
 * **Display only.** The raw string is what the update check compares, so
 * normalising it at the source would have it asking whether "23/07/2026" equals
 * "20260723" and re-downloading forever.
 */
export function releaseDate(version: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})$/u.exec(version);
  if (!match) return version;
  const [, year, month, day] = match;
  return panelLang() === "zh"
    ? `${year}年${Number(month)}月${Number(day)}日`
    : `${day}/${month}/${year}`;
}

export function describe(message: RowMessage): string {
  switch (message.kind) {
    case "absent":
      return `${t("dictNotInstalled")} · ${releaseDate(message.version)}`;
    case "installed": {
      let line = t("dictInstalledState");
      if (message.version !== undefined) line += ` · ${releaseDate(message.version)}`;
      // A standing fact about the disk, so it outlives the cooldown that
      // "already the newest release" fades with.
      if (message.updateAvailable) line += ` · ${t("dictUpdateAvailable")}`;
      else if (message.upToDate) line += ` · ${t("dictUpToDate")}`;
      return line;
    }
    case "checking":
      return t("dictChecking");
    case "downloading":
      return `${t("dictDownloading")} ${mb(message.received)} / ${mb(message.total)}`;
    case "installing": {
      // The two measurable phases carry their byte counts. The swap and the
      // load are neither long nor divisible, so a bar there would be a bar that
      // never moves.
      const label =
        message.phase === "verifying"
          ? t("dictVerifying")
          : message.phase === "extracting"
            ? t("dictUnpacking")
            : t("dictActivating");
      return message.total > 0 ? `${label} ${mb(message.done)} / ${mb(message.total)}` : label;
    }
    case "failed":
      return `${t("dictFailed")}: ${t(`dictFail_${message.reason.replace(/-/gu, "_")}` as never)}`;
    case "updateCheckFailed":
      return t("dictUpdateCheckFailed");
    case "cancelled":
      return t("dictFail_cancelled");
    case "noSpace":
      return tNoSpace(mb(message.needed));
  }
}

export function actionLabel(action: RowAction): string {
  switch (action.kind) {
    case "install":
      return t("dictInstall");
    case "update":
      return t("dictUpdate");
    case "retry":
      return t("dictRetry");
    case "working":
      return action.of === "checking"
        ? t("dictWorkChecking")
        : action.of === "downloading"
          ? t("dictWorkDownloading")
          : t("dictWorkInstalling");
  }
}
