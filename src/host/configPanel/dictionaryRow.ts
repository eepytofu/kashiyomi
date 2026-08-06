// The one control for the Japanese dictionary: install it, switch edition,
// update it. Today it is also the whole first-run experience, because a fresh
// install has no dictionary and this row's empty state is the only thing that
// says so.
//
// BetterNCM has no notification or toast API (checked against js-framework), so
// nothing here may reach outside the settings panel. Inside it is fair game: a
// setup dialog is a transient, dismissible, user-invoked surface, not the
// lyrics page.
//
// This file decides nothing. `dictionaryRowState` is a pure function over the
// inventory, the job, the clock and the free space; what remains here is
// turning that value into DOM and words. Keeping the two apart is what makes
// fourteen states testable, and it is what lets the same states move into a
// dialog without being rewritten.

import { panelLang, t, tDownloadEdition, tNoSpace, tSpaceForOther } from "../i18n.ts";
import {
  cancelDictionaryDownload,
  dictionaryInventory,
  dictionaryJob,
  downloadDictionary,
  installedEditions,
  onDictionaryChange,
  planDownload,
  reportNoSource,
  reportUpToDate,
  resolveRelease,
  type DownloadPlan,
} from "../dictionary.ts";
import {
  dictionaryRowState,
  type RowAction,
  type RowDot,
  type RowMessage,
} from "../../engine/dictionaryRowState.ts";
import { pinnedRelease } from "../../engine/dictionaryPins.ts";
import { currentAssetPaths } from "../annotator.ts";
import { getSettings, updateSettings } from "../settings.ts";
import { resetAnalysisCache } from "../analysisCache.ts";
import { rescan } from "../annotator.ts";
import { nativeFreeSpace } from "../native.ts";
import type { DictionaryEdition } from "../../engine/dictionarySource.ts";
import { onPanelTeardown } from "./lifecycle.ts";
import { row, rowText, styledSelect } from "./rows.ts";

const MB = 1024 * 1024;
const mb = (bytes: number) => `${(bytes / MB).toFixed(1)} MB`;

const DOT_CLASS: Record<RowDot, string> = {
  ready: "kc-ready",
  loading: "kc-loading",
  bad: "kc-bad",
  neutral: "",
};

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
const releaseDate = (version: string): string => {
  const match = /^(\d{4})(\d{2})(\d{2})$/u.exec(version);
  if (!match) return version;
  const [, year, month, day] = match;
  return panelLang() === "zh"
    ? `${year}年${Number(month)}月${Number(day)}日`
    : `${day}/${month}/${year}`;
};

function describe(message: RowMessage): string {
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
      if (message.upToDate) line += ` · ${t("dictUpToDate")}`;
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
      return message.total > 0
        ? `${label} ${mb(message.done)} / ${mb(message.total)}`
        : label;
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

function actionLabel(action: RowAction): string {
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
function actionEdition(action: RowAction, preferred: DictionaryEdition): DictionaryEdition {
  return action.kind === "installEdition" ? action.edition : preferred;
}

export function dictionaryRow(): HTMLElement {
  const el = row();
  el.classList.add("kc-row-dict");
  const text = rowText(t("dictionary"), t("dictNotInstalled"));
  const description = text.querySelector(".kc-desc") ?? text.lastElementChild;
  const dot = document.createElement("span");
  dot.className = "kc-dot";
  text.querySelector(".kc-label")?.prepend(dot);
  el.appendChild(text);

  const { wrap: editionWrap, select: edition } = styledSelect();
  // Ordered smallest first here, unlike DICTIONARY_EDITIONS: a picker reads as
  // a ladder, and the recommended middle option should not be last.
  for (const value of ["small", "core", "full"] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = `${value} · ${mb(pinnedRelease(value).size)}`;
    edition.appendChild(option);
  }
  // What the selected edition contains, under the picker rather than hidden in
  // a tooltip.
  const editionNote = document.createElement("div");
  editionNote.className = "kc-desc kc-dict-note";
  edition.value = getSettings().dictPreferredEdition;
  el.appendChild(editionWrap);

  const button = document.createElement("button");
  button.className = "kc-button";
  el.appendChild(button);

  // Always in the DOM, hidden rather than absent, so the row does not change
  // height the moment a download starts.
  const cancel = document.createElement("button");
  cancel.className = "kc-button";
  cancel.textContent = t("dictCancel");
  cancel.style.display = "none";
  cancel.onclick = () => cancelDictionaryDownload();
  el.appendChild(cancel);

  // Appended last so it wraps onto its own line beneath the controls. Inline
  // between the label and the picker it was a fourth column competing for
  // width: measured at a 1536px window, a 175px note left the label 67px and
  // wrapped "Japanese dictionary" over three lines.
  el.appendChild(editionNote);

  let poll: number | undefined;
  // Asked of the disk rather than on every paint: a native dispatch three times
  // a second to answer a question that changes when an install finishes is
  // work for nothing.
  let freeBytes = readFreeSpace();

  const paint = () => {
    // Retried while unknown, because the panel can be built before the asset
    // paths resolve. Leaving it undefined for the session would silently skip
    // the space check for as long as the panel stayed open, which is the same
    // class of quiet skip this step exists to close.
    if (freeBytes === undefined) freeBytes = readFreeSpace();
    const view = dictionaryRowState({
      preferred: getSettings().dictPreferredEdition,
      inventory: dictionaryInventory(),
      job: dictionaryJob(),
      now: Date.now(),
      freeBytes,
    });

    el.classList.remove("kc-ready", "kc-loading", "kc-bad");
    if (DOT_CLASS[view.dot]) el.classList.add(DOT_CLASS[view.dot]);
    if (description) description.textContent = describe(view.message);

    button.textContent = actionLabel(view.primary.action);
    button.disabled = view.primary.disabled;
    button.style.opacity = view.primary.disabled ? "0.5" : "";

    cancel.style.display = view.cancel.shown ? "" : "none";
    cancel.disabled = view.cancel.disabled;
    cancel.style.opacity = view.cancel.disabled ? "0.5" : "";

    edition.disabled = !view.pickerEnabled;
    editionWrap.style.opacity = view.pickerEnabled ? "" : "0.5";
    // Follow the preference wherever it was changed from, including the view
    // offering a smaller edition and the press accepting it.
    edition.value = getSettings().dictPreferredEdition;

    // A cooldown expiring changes the view with no event to hang a repaint on,
    // so the view says when it is still moving and the timer follows that
    // rather than guessing from the job.
    if (view.settling) startPolling();
  };

  const startPolling = () => {
    if (poll !== undefined) return;
    poll = window.setInterval(() => {
      const settling = dictionaryRowState({
        preferred: getSettings().dictPreferredEdition,
        inventory: dictionaryInventory(),
        job: dictionaryJob(),
        now: Date.now(),
        freeBytes,
      }).settling;
      paint();
      if (!settling) {
        window.clearInterval(poll);
        poll = undefined;
      }
    }, 300);
  };

  const paintEditionNote = () => {
    const chosen = getSettings().dictPreferredEdition;
    const key = (
      { small: "dictEdSmall", core: "dictEdCore", full: "dictEdFull" } as const
    )[chosen];
    editionNote.textContent =
      chosen === "full" ? `${t(key)} ${t("dictEdFullWarning")}` : t(key);
  };

  edition.onchange = () => {
    updateSettings({ dictPreferredEdition: edition.value as DictionaryEdition });
    paintEditionNote();
    paint();
  };

  button.onclick = () => {
    void (async () => {
      const paths = currentAssetPaths();
      if (!paths) return;
      const dir = paths.dictDir;
      const preferred = getSettings().dictPreferredEdition;
      const action = dictionaryRowState({
        preferred,
        inventory: dictionaryInventory(),
        job: dictionaryJob(),
        now: Date.now(),
        freeBytes,
      }).primary.action;
      const chosen = actionEdition(action, preferred);
      // Taking the offer of a smaller edition is a choice, so it is recorded as
      // one. Otherwise the next launch would try the edition that does not fit
      // all over again.
      if (chosen !== preferred) {
        updateSettings({ dictPreferredEdition: chosen });
        paintEditionNote();
      }

      startPolling();
      // Resolve live so an update gets the newest release; fall back to the
      // pinned one, which is always installable even with every source blocked.
      const { release, checked } = await resolveRelease(chosen);

      // Nothing to do if the installed dictionary is already this release.
      // Re-downloading 69 MB to arrive at the same file is not an update, and
      // the button was happy to do it as often as it was pressed. Asked per
      // edition now, so switching away and back does not re-fetch a file whose
      // version is still recorded.
      const inventory = dictionaryInventory();
      if (
        inventory.installed.includes(release.edition) &&
        inventory.versions[release.edition] === release.version
      ) {
        // The one honest use of `no-source`: this edition is already at the
        // pinned version and nothing answered when asked whether a newer one
        // exists. Saying "already the newest release" there would be reporting
        // an answer to a question that was never received.
        if (checked) reportUpToDate(release.edition);
        else reportNoSource(release.edition);
        return;
      }

      // Ask the disk what is there, so switching edition can hand the backend
      // the file it supersedes and reclaim its 207 MB once the new one loads.
      const plan: DownloadPlan = planDownload(release, dir, await installedEditions(dir));
      const result = await downloadDictionary(plan, paths.resourceDir);
      freeBytes = readFreeSpace();
      // A new dictionary changes every reading in the song. The annotation
      // cache is keyed by line text, so rescan alone would put every line back
      // with its old reading and the whole download would look like it did
      // nothing.
      if (result.kind === "idle") {
        resetAnalysisCache();
        void rescan();
      }
      paint();
    })();
  };

  paintEditionNote();
  paint();
  // Follow the status wherever it is changed from, not just this row's own
  // button: the panel is built once and would otherwise keep showing whatever
  // was true when it was opened.
  //
  // Both handles are surrendered on teardown. The unsubscribe used to be
  // discarded, so every panel rebuild left another copy of this row painting
  // into a detached node for the rest of the session.
  const unsubscribe = onDictionaryChange(paint);
  onPanelTeardown(() => {
    unsubscribe();
    if (poll !== undefined) {
      window.clearInterval(poll);
      poll = undefined;
    }
  });
  return el;
}

function readFreeSpace(): number | undefined {
  const dir = currentAssetPaths()?.dictDir;
  return dir === undefined ? undefined : nativeFreeSpace(dir);
}
