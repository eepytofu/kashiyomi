// The one control for the Japanese dictionary: install it, switch edition,
// update it.
//
// First run is not a separate flow — it is this row's empty state. That is
// deliberate: BetterNCM has no notification or toast API (checked against
// js-framework), so the alternative would be overlaying NCM's own UI, which
// our first hard rule and the store's non-invasive guidance both forbid. It
// also means **no "have they seen the welcome screen" flag to persist**, since
// "no dictionary present" is the signal and it clears itself.
//
// Built from what the panel already has: rowText carrying live data like
// clearCacheRow, a kc-button that disables while working, and the analyzer
// status bar's kc-dot states.

import { panelLang, t } from "../i18n.ts";
import {
  dictionaryStatus,
  downloadDictionary,
  installedEditions,
  onDictionaryStatusChange,
  planDownload,
  resolveRelease,
  type DownloadPlan,
} from "../dictionary.ts";
import { pinnedRelease } from "../../engine/dictionaryPins.ts";
import { currentAssetPaths } from "../annotator.ts";
import { getSettings, updateSettings } from "../settings.ts";
import { resetAnalysisCache } from "../analysisCache.ts";
import { rescan } from "../annotator.ts";
import type { DictionaryEdition } from "../../engine/dictionarySource.ts";
import { row, rowText, styledSelect } from "./rows.ts";

const MB = 1024 * 1024;
const mb = (bytes: number) => `${(bytes / MB).toFixed(1)} MB`;

/**
 * SudachiDict versions are release dates as `20260723`. Formatted per panel
 * language, because the two do not agree and neither is "the superior format":
 *
 *   - Chinese and Japanese are **year first**, 2026年7月23日. That is not a
 *     preference, it is the word order — 年月日 — and GB/T 7408 follows ISO 8601.
 *   - Indonesian and most of Europe are day first, 23/07/2026. English is split,
 *     since the US puts the month first, so day-first is the safer default for
 *     the English panel.
 *
 * **Display only.** The raw string is what the update check compares, so
 * normalising it at the source would have it asking whether "23/07/2026" equals
 * "20260723" and re-downloading forever.
 */
const releaseDate = (version: string): string => {
  const match = /^(\d{4})(\d{2})(\d{2})$/u.exec(version);
  if (!match) return version;
  const [, year, month, day] = match;
  return panelLang() === "zh"
    ? `${year}年${Number(month)}月${Number(day)}日`
    : `${day}/${month}/${year}`;
};

export function dictionaryRow(): HTMLElement {
  const el = row();
  const text = rowText(t("dictionary"), t("dictNotInstalled"));
  const description = text.querySelector(".kc-desc") ?? text.lastElementChild;
  el.appendChild(text);

  const { wrap: editionWrap, select: edition } = styledSelect();
  for (const value of ["core", "small"] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = `${value} · ${mb(pinnedRelease(value).size)}`;
    edition.appendChild(option);
  }
  edition.value = getSettings().dictEdition;
  el.appendChild(editionWrap);

  const button = document.createElement("button");
  button.className = "kc-button";
  el.appendChild(button);

  let poll: number | undefined;
  // Shown briefly after an update check that found nothing newer.
  let upToDate = false;

  const paint = () => {
    const status = dictionaryStatus();
    const chosen = edition.value as DictionaryEdition;
    const pinned = pinnedRelease(chosen);
    let label = "";
    let action = t("dictInstall");
    let busy = false;

    switch (status.kind) {
      case "absent":
        label = `${t("dictNotInstalled")} · ${chosen} ${releaseDate(pinned.version)} · ${mb(pinned.size)}`;
        break;
      case "downloading":
        label = `${t("dictDownloading")} ${mb(status.received)} / ${mb(status.total)}`;
        busy = true;
        break;
      case "installing":
        label = t("dictInstalling");
        busy = true;
        break;
      case "installed":
        label = status.version
          ? `${status.edition} · ${releaseDate(status.version)}`
          : status.edition;
        if (upToDate) label += ` · ${t("dictUpToDate")}`;
        action = status.edition === chosen ? t("dictUpdate") : t("dictSwitch");
        break;
      case "failed":
        label = `${t("dictFailed")}: ${t(`dictFail_${status.reason.replace(/-/gu, "_")}` as never)}`;
        action = t("dictRetry");
        break;
    }
    if (description) description.textContent = label;
    button.textContent = action;
    button.disabled = busy;
    button.style.opacity = busy ? "0.5" : "";
  };

  // Poll only while the answer can still change — the same discipline the
  // analyzer status bar uses. A finished download runs no timer.
  const startPolling = () => {
    if (poll !== undefined) return;
    poll = window.setInterval(() => {
      paint();
      const kind = dictionaryStatus().kind;
      if (kind !== "downloading" && kind !== "installing") {
        window.clearInterval(poll);
        poll = undefined;
      }
    }, 300);
  };

  edition.onchange = () => {
    updateSettings({ dictEdition: edition.value as DictionaryEdition });
    paint();
  };

  button.onclick = () => {
    void (async () => {
      const paths = currentAssetPaths();
      if (!paths) return;
      const chosen = edition.value as DictionaryEdition;
      const dir = paths.dictDir;

      button.disabled = true;
      startPolling();
      // Resolve live so an update gets the newest release; fall back to the
      // pinned one, which is always installable even with every source blocked.
      const release = await resolveRelease(chosen);
      if (!release) {
        paint();
        return;
      }

      // Nothing to do if the installed dictionary is already this release.
      // Re-downloading 69 MB to arrive at the same file is not an update, and
      // the button was happy to do it as often as it was pressed.
      const current = dictionaryStatus();
      if (
        current.kind === "installed" &&
        current.edition === release.edition &&
        current.version === release.version
      ) {
        upToDate = true;
        paint();
        window.setTimeout(() => {
          upToDate = false;
          paint();
        }, 4000);
        return;
      }

      // Ask the disk what is there, so switching edition can hand the backend
      // the file it supersedes and reclaim its 207 MB once the new one loads.
      const plan: DownloadPlan = planDownload(release, dir, await installedEditions(dir));
      const result = await downloadDictionary(plan, paths.resourceDir);
      // A new dictionary changes every reading in the song. The annotation
      // cache is keyed by line text, so rescan alone would put every line back
      // with its old reading and the whole download would look like it did
      // nothing.
      if (result.kind === "installed") {
        resetAnalysisCache();
        void rescan();
      }
      paint();
    })();
  };

  paint();
  // Follow the status wherever it is changed from, not just this row's own
  // button: the panel is built once and would otherwise keep showing whatever
  // was true when it was opened.
  onDictionaryStatusChange(paint);
  return el;
}
