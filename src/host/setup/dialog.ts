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
// defaults that is one thing, which is the dictionary.
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
import { actionLabel, describe, mb, size } from "../dictionaryText.ts";
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

  const need = document.createElement("div");
  need.className = "ks-need";
  need.textContent = t("setupNeedsDictionary").replace("{size}", mb(pinnedRelease().size));
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

  const cancel = document.createElement("button");
  cancel.className = "kc-button";
  cancel.textContent = t("dictCancel");
  cancel.onclick = () => cancelDictionaryDownload();
  actions.appendChild(cancel);

  const spacer = document.createElement("div");
  spacer.className = "ks-spacer";
  actions.appendChild(spacer);

  const close = document.createElement("button");
  close.className = "kc-button";
  close.textContent = t("setupLater");
  close.onclick = () => {
    updateSettings({ dictSetupSeen: "later" });
    dialog.close();
  };
  actions.appendChild(close);

  const never = document.createElement("button");
  never.className = "kc-button";
  never.textContent = t("setupNever");
  never.onclick = () => {
    // The settings row stays the way back in, which is what makes this safe to
    // offer rather than a decision the user cannot undo.
    updateSettings({ dictSetupSeen: "never" });
    dialog.close();
  };
  actions.appendChild(never);

  let freeBytes = readFreeSpace();

  const view = (): ReturnType<typeof dictionaryRowState> =>
    dictionaryRowState({
      inventory: dictionaryInventory(),
      job: dictionaryJob(),
      now: Date.now(),
      freeBytes,
      ownsJob: true,
    });

  const paint = (): void => {
    if (freeBytes === undefined) freeBytes = readFreeSpace();
    const current = view();

    // Hidden once something is running: it answers "will this fit", which is a
    // question about a download that has already started.
    space.textContent =
      freeBytes === undefined || current.settling
        ? ""
        : t("setupSpace")
            .replace("{needed}", mb(requiredFreeBytes(pinnedRelease().size)))
            .replace("{free}", size(freeBytes));

    status.textContent = describe(current.message);
    status.className = `ks-status ks-${current.dot}`;

    primary.textContent = actionLabel(current.primary.action);
    primary.disabled = current.primary.disabled;
    cancel.style.display = current.cancel.shown ? "" : "none";
    cancel.disabled = current.cancel.disabled;

    // Once a dictionary is in place the dialog has done its job, so the way out
    // stops being a deferral and becomes an ordinary close.
    if (dictionaryInventory().installed) {
      close.textContent = t("setupClose");
      never.style.display = "none";
    }
    if (current.settling) startPolling();
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
      const settling = view().settling;
      paint();
      if (!settling) stopPolling();
    }, 300);
  };

  primary.onclick = () => {
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
    if (getSettings().dictSetupSeen === "") updateSettings({ dictSetupSeen: "later" });
    dialog.remove();
    if (open === dialog) open = undefined;
  });

  document.body.appendChild(dialog);
  paint();
  dialog.showModal();
}
