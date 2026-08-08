// Turning the dictionary view model into words.

import { panelLang, t, tNoSpace } from "./i18n.ts";
import type { RowAction, RowMessage } from "../engine/dictionaryRowState.ts";

const MEGABYTE = 1024 * 1024;
const GIGABYTE = 1024 * MEGABYTE;

/** Download and requirement sizes, which are always in the tens or hundreds. */
export const mb = (bytes: number): string => `${(bytes / MEGABYTE).toFixed(1)} MB`;

/** A size that could be anything, in whichever unit a person would use. */
export const size = (bytes: number): string =>
  bytes >= GIGABYTE ? `${(bytes / GIGABYTE).toFixed(1)} GB` : mb(bytes);

/**
 * SudachiDict versions are release dates as `20260723`. Formatted per panel
 * language, because the two do not agree and neither is "the superior format":
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
      // Before the update segments: what the analyzer is doing with the file
      // outranks whether a newer one exists, because a dictionary that will not
      // open is the more urgent fact.
      if (message.analyzer === "loading") line += ` · ${t("dictAnalyzerLoading")}`;
      else if (message.analyzer === "failed") line += ` · ${t("dictAnalyzerFailed")}`;
      // Both are standing facts now rather than transient reports: one compares
      // the recorded version against what a check saw, the other says a check
      // ran recently and found nothing. Mutually exclusive by construction.
      if (message.updateAvailable) line += ` · ${t("dictUpdateAvailable")}`;
      else if (message.upToDate) line += ` · ${t("dictUpToDate")}`;
      // Why the button is down, next to the button. The cooldown is minutes, so
      // one phrase covers the whole window and neither language needs a plural.
      if (message.checkedAgoMs !== undefined) line += ` · ${t("dictCheckedJustNow")}`;
      return line;
    }
    case "checking":
      return t("dictChecking");
    case "downloading":
      return `${t("dictDownloading")} ${mb(message.received)} / ${mb(message.total)}`;
    case "installing":
      // No byte counts here. Measured on a real install: extracting runs 207 MB
      return message.phase === "verifying"
        ? t("dictVerifying")
        : message.phase === "extracting"
          ? t("dictUnpacking")
          : t("dictActivating");
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
    // The one button becomes the way out while a download or an early install
    // phase can still be abandoned; the description beside it carries the
    // progress, so no label is lost by not saying "Downloading…" here.
    case "cancel":
      return t("dictCancel");
    case "working":
      return action.of === "checking" ? t("dictWorkChecking") : t("dictWorkInstalling");
  }
}
