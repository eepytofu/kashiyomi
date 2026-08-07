// The first-run dictionary dialog: say what is missing, offer to fetch it.
//
// **First run only.** It used to double as a manage surface reached from
// settings, because there were three editions and something had to present the
// choice. There is one edition now, so managing is a single button and it lives
// on the settings row where the state is already reported. What is left here is
// the job a settings row cannot do: speak up on a fresh install, before the
// user meets a plugin that silently does nothing on Japanese lyrics.
//
// **It does not describe the plugin.** An earlier version opened with a summary
// of every feature, which is a pitch in a place where nobody needs one: whoever
// is looking at this installed from a listing that already described it. What
// earns space is only what the user must act on, and against the shipped
// defaults that is two things. The dictionary, which is here. And an API key,
// which cannot be here, because the settings panel has six coupled controls for
// it and half a copy would be two places to configure one feature -- so it is
// named and pointed at, not offered.
//
// **Why a dialog is allowed here.** The project's first rule protects the lyrics
// page: never replace it, never overlay it. A transient, dismissible surface is
// not the lyrics page, and a plugin that cannot mention a 69 MB prerequisite it
// does not have is a plugin that silently does nothing. BetterNCM has no toast
// or notification API, so this is the only way to say it.
//
// `<dialog>` and `::backdrop` were checked against the real runtime before this
// was written (CEF 91 / Chrome 91.0.4472.164): both work. `inert` and `:has()`
// do not, so focus containment is by hand.

import { t } from "../i18n.ts";
import {
  cancelDictionaryDownload,
  dictionaryInventory,
  dictionaryJob,
  onDictionaryChange,
} from "../dictionary.ts";
import { startDictionaryInstall } from "../dictionaryInstall.ts";
import { dictionaryRowState } from "../../engine/dictionaryRowState.ts";
import { pinnedRelease } from "../../engine/dictionaryPins.ts";
import { requiredFreeBytes } from "../../engine/dictionarySource.ts";
import { describe, mb, size } from "../dictionaryText.ts";
import { currentAssetPaths } from "../annotator.ts";
import { nativeFreeSpace } from "../native.ts";
import { getSettings, updateSettings } from "../settings.ts";
import { SETUP_CSS } from "./styles.ts";
import { UI_ROOT_CLASS, ensureSharedStyles } from "../uiStyles.ts";

let open: HTMLDialogElement | undefined;

function ensureStyles(): void {
  ensureSharedStyles();
  if (document.getElementById("kashiyomi-setup-css")) return;
  const style = document.createElement("style");
  style.id = "kashiyomi-setup-css";
  style.textContent = SETUP_CSS;
  document.head.appendChild(style);
}

function readFreeSpace(): number | undefined {
  const dir = currentAssetPaths()?.dictDir;
  return dir === undefined ? undefined : nativeFreeSpace(dir);
}

/** Show the dialog, or bring an existing one forward. */
export function openDictionarySetup(): void {
  if (open?.isConnected) {
    open.showModal();
    return;
  }
  ensureStyles();

  const dialog = document.createElement("dialog");
  dialog.className = `kashiyomi-setup ${UI_ROOT_CLASS}`;
  open = dialog;

  // The plugin's name, because this is the first thing it ever says and the
  // person reading it has just installed something.
  const title = document.createElement("div");
  title.className = "ks-title";
  title.textContent = "Kashiyomi（歌詞読み）";
  dialog.appendChild(title);

  const what = document.createElement("div");
  what.className = "ks-need";
  what.textContent = t("setupWhatItIs");
  dialog.appendChild(what);

  const need = document.createElement("div");
  need.className = "ks-need";
  need.textContent = t("setupNeedsDictionary");
  dialog.appendChild(need);

  const space = document.createElement("div");
  space.className = "ks-space";
  dialog.appendChild(space);

  const status = document.createElement("div");
  status.className = "ks-status";
  dialog.appendChild(status);

  const actions = document.createElement("div");
  actions.className = "ks-actions";
  dialog.appendChild(actions);

  const primary = document.createElement("button");
  primary.className = "kc-button ks-primary";
  actions.appendChild(primary);

  const spacer = document.createElement("div");
  spacer.className = "ks-spacer";
  actions.appendChild(spacer);

  // One dismissal. A second button offering "don't ask again" said nothing the
  // first did not already do, because nothing re-raises this dialog either way.
  const close = document.createElement("button");
  close.className = "kc-button";
  close.textContent = t("setupLater");
  close.onclick = () => {
    updateSettings({ dictSetupAnswered: true });
    dialog.close();
  };
  actions.appendChild(close);

  let freeBytes = readFreeSpace();

  /**
   * Which of the wizard's three states applies.
   *
   * **Not `dictionaryRowState`.** That is the settings row's model and it
   * answers "what can be done to this dictionary right now" — install, update,
   * cancel, retry — which is right for a control that lives forever. A wizard is
   * a task with an end, and its only question is whether a dictionary exists
   * yet. Borrowing the row's model is what put an Update button and a freshness
   * claim in front of someone who had finished downloading ten seconds earlier.
   */
  const state = (): "needed" | "working" | "done" => {
    const job = dictionaryJob();
    if (job.kind === "resolving" || job.kind === "downloading" || job.kind === "installing") {
      return "working";
    }
    return dictionaryInventory().installed ? "done" : "needed";
  };

  /** Whether the running job is at a point that can still be abandoned. */
  const cancellable = (): boolean => {
    const job = dictionaryJob();
    if (job.kind === "downloading") return true;
    return job.kind === "installing" && (job.phase === "verifying" || job.phase === "extracting");
  };

  const paint = (): void => {
    if (freeBytes === undefined) freeBytes = readFreeSpace();
    const now = state();

    // Held through the download, dropped only once it is done.
    //
    // It answers "will this fit", so strictly it stops being a question the
    // moment a transfer starts. Blanking it there is defensible and looked
    // wrong: the row is height-reserved, so the text vanished and left an empty
    // gap above the status, and an element disappearing with no replacement
    // reads as something broken. At DONE the success line takes over and the
    // dialog is ending, which is a natural place for it to go.
    space.textContent =
      now !== "done" && freeBytes !== undefined
        ? t("setupSpace")
            .replace("{needed}", mb(requiredFreeBytes(pinnedRelease().size)))
            .replace("{free}", size(freeBytes))
        : "";

    if (now === "working") {
      status.textContent = describe(
        dictionaryRowState({
          inventory: dictionaryInventory(),
          job: dictionaryJob(),
          now: Date.now(),
          freeBytes,
          ownsJob: true,
        }).message,
      );
      status.className = "ks-status ks-loading";
      primary.textContent = cancellable() ? t("dictCancel") : t("dictWorkInstalling");
      primary.disabled = !cancellable();
      startPolling();
      return;
    }

    if (now === "done") {
      status.textContent = t("setupInstalled");
      status.className = "ks-status ks-ready";
      // The task is finished, so the button finishes it. No update step: this
      // flow does not have one, and the settings row is where updating lives.
      primary.textContent = t("setupDone");
      primary.disabled = false;
      close.style.display = "none";
      return;
    }

    status.textContent = describe({ kind: "absent", version: pinnedRelease().version });
    status.className = "ks-status ks-bad";
    primary.textContent = t("dictInstall");
    primary.disabled = false;
    close.style.display = "";
  };

  let poll: number | undefined;
  const stopPolling = (): void => {
    if (poll === undefined) return;
    window.clearInterval(poll);
    poll = undefined;
  };
  const startPolling = (): void => {
    if (poll !== undefined) return;
    poll = window.setInterval(() => {
      const working = state() === "working";
      paint();
      if (!working) stopPolling();
    }, 300);
  };

  primary.onclick = () => {
    // Three states, three meanings: stop the transfer, finish the wizard, or
    // start the download.
    if (state() === "working") {
      if (cancellable()) cancelDictionaryDownload();
      return;
    }
    if (state() === "done") {
      updateSettings({ dictSetupAnswered: true });
      dialog.close();
      return;
    }
    startPolling();
    void startDictionaryInstall().then(() => {
      freeBytes = readFreeSpace();
      paint();
    });
  };

  const unsubscribe = onDictionaryChange(paint);
  dialog.addEventListener("close", () => {
    unsubscribe();
    stopPolling();
    // Marked as answered however it was dismissed. Reaching this dialog and
    // walking away is still an answer, and re-raising it every launch after
    // that would be nagging.
    if (!getSettings().dictSetupAnswered) updateSettings({ dictSetupAnswered: true });
    dialog.remove();
    if (open === dialog) open = undefined;
  });

  document.body.appendChild(dialog);
  paint();
  dialog.showModal();
}
