// Turning the dictionary view model into words.
//
// Shared by the settings row and the setup dialog. They show the same states in
// different containers, and the plan's requirement is explicit: one source or
// the two drift. `dictionaryRowState` decides, this says it, and neither knows
// what DOM it ends up in.

import { panelLang, t, tDownloadEdition, tNoSpace, tSpaceForOther } from "./i18n.ts";
import type { EditionStatus, RowAction, RowMessage } from "../engine/dictionaryRowState.ts";
import { needsRelay, type DictionaryEdition } from "../engine/dictionarySource.ts";
import { pinnedRelease } from "../engine/dictionaryPins.ts";

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
      // The edition is named only when it is *not* the one selected. The picker
      // already says which edition is selected and how big it is, so repeating
      // both in the description was the same fact printed twice.
      let line = message.isSelection
        ? t("dictInstalledState")
        : `${message.edition} ${t("dictInstalledState")}`;
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
    case "spaceForOther":
      return tSpaceForOther(message.wanted, message.fits, mb(message.needed));
  }
}

/**
 * The same states, for a surface whose list already shows what is installed.
 *
 * The dialog's options say `installed` and `in use` on themselves, so a status
 * line underneath reading "core installed" is the same fact a second time, and
 * about whichever edition happens to be loaded rather than the one being
 * pointed at. What is left worth saying is the part the list cannot carry: the
 * release on disk, and whether something newer exists.
 *
 * Everything that is not a settled state falls through to `describe`, because
 * progress and failures read identically wherever they appear.
 */
export function describeDetail(message: RowMessage): string {
  if (message.kind === "absent") return releaseDate(message.version);
  if (message.kind !== "installed") return describe(message);
  const parts: string[] = [];
  if (message.version !== undefined) parts.push(releaseDate(message.version));
  if (message.updateAvailable) parts.push(t("dictUpdateAvailable"));
  else if (message.upToDate) parts.push(t("dictUpToDate"));
  return parts.join(" · ");
}

export function actionLabel(action: RowAction): string {
  switch (action.kind) {
    case "install":
      return t("dictInstall");
    case "update":
      return t("dictUpdate");
    case "switch":
      return t("dictSwitch");
    case "retry":
      return t("dictRetry");
    case "installEdition":
      return tDownloadEdition(action.edition);
    case "working":
      return action.of === "checking"
        ? t("dictWorkChecking")
        : action.of === "downloading"
          ? t("dictWorkDownloading")
          : t("dictWorkInstalling");
  }
}

/** Which edition a press acts on: the selection, unless the view offered another. */
export function actionEdition(
  action: RowAction,
  preferred: DictionaryEdition,
): DictionaryEdition {
  return action.kind === "installEdition" ? action.edition : preferred;
}

/**
 * Join two sentences the way the script they are written in would.
 *
 * A full-width stop already carries its own trailing space inside the glyph
 * box, so following it with an ASCII space leaves a visible gap: measured in the
 * live dialog as `仅收录 UniDic 的词汇。 从 PyPI 下载。`. Latin punctuation
 * needs the space, CJK punctuation does not, and which one applies is a
 * property of the preceding character rather than of the panel language.
 */
function joinSentences(first: string, second: string): string {
  return /[。！？；：]$/u.test(first) ? `${first}${second}` : `${first} ${second}`;
}

/**
 * The option's first line: what it is, how big, and where it comes from.
 *
 * Source is a word here rather than a sentence underneath, because as a
 * sentence it had to be repeated on two of the three rows and read as noise
 * ("both downloads from PyPI itu aneh"). As a suffix the three line up, and
 * `full` being different is visible by contrast instead of by paragraph.
 */
export function editionHeading(edition: DictionaryEdition): string {
  const source = needsRelay(edition) ? "GitHub" : "PyPI";
  return `${edition} · ${mb(pinnedRelease(edition).size)} · ${source}`;
}

/** What an edition contains, in the publisher's own words. */
export function editionNote(edition: DictionaryEdition): string {
  const key = ({ small: "dictEdSmall", core: "dictEdCore", full: "dictEdFull" } as const)[edition];
  // Only the edition that is not on PyPI says anything further, and it says the
  // part a user can act on: someone other than the publisher may serve it.
  return needsRelay(edition) ? joinSentences(t(key), t("dictEdFromFull")) : t(key);
}

/** `installed` or `in use`, shown on the option itself. */
export function editionStatusLabel(status: EditionStatus): string {
  if (status === "in-use") return t("dictInUse");
  return status === "installed" ? t("dictInstalledState") : "";
}
