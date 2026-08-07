// The dictionary setup dialog: choose an edition, download it, watch it go.
//
// One surface for two jobs. On first run it raises itself; from settings it is
// the Manage button. They are the same states, so they are the same dialog
// rather than two that drift, and `firstRun` changes only the dismissals.
//
// **It does not describe the plugin.** An earlier version opened with a summary
// of every feature, which is a pitch in a place where nobody needs one: whoever
// is looking at this either installed from a listing that already described it,
// or pressed a button inside its own settings. What earns space is only what
// the user must act on, and measured against the shipped defaults that is two
// things. The Japanese dictionary, which is here. And an API key, which cannot
// be here, because the settings panel has six coupled controls for it and half
// a copy would be two places to configure one feature.
//
// **Why a dialog is allowed here.** The project's first rule protects the lyrics
// page: never replace it, never overlay it. A transient, dismissible,
// user-invoked surface is not the lyrics page, and a plugin that cannot speak
// about a 69 MB prerequisite it does not have is a plugin that silently does
// nothing. BetterNCM has no toast or notification API, so this is the only way
// to say it.
//
// `<dialog>` and `::backdrop` were checked against the real runtime before this
// was written (CEF 91 / Chrome 91.0.4472.164): both work. `inert` and `:has()`
// do not, so focus containment is by hand.

import { t } from "../i18n.ts";
import {
  cancelDictionaryDownload,
  checkForNewerRelease,
  clearFinishedJob,
  dictionaryInventory,
  dictionaryJob,
  onDictionaryChange,
} from "../dictionary.ts";
import { startDictionaryInstall } from "../dictionaryInstall.ts";
import { dictionaryRowState, editionStatus } from "../../engine/dictionaryRowState.ts";
import { pinnedRelease } from "../../engine/dictionaryPins.ts";
import type { DictionaryEdition } from "../../engine/dictionarySource.ts";
import { requiredFreeBytes } from "../../engine/dictionarySource.ts";
import {
  actionEdition,
  actionLabel,
  describe,
  editionHeading,
  editionNote,
  editionStatusLabel,
  mb,
  size,
} from "../dictionaryText.ts";
import { currentAssetPaths } from "../annotator.ts";
import { nativeFreeSpace } from "../native.ts";
import { getSettings, updateSettings } from "../settings.ts";
import { SETUP_CSS } from "./styles.ts";
import { UI_ROOT_CLASS, ensureSharedStyles } from "../uiStyles.ts";

/**
 * Smallest first, unlike `DICTIONARY_EDITIONS`.
 *
 * A list of choices reads as a ladder, and the recommended option should not be
 * the last thing considered. `core` sits in the middle for the same reason it is
 * the default.
 */
const OFFERED: readonly DictionaryEdition[] = ["small", "core", "full"];

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

/**
 * Show the dialog, or bring the existing one forward.
 *
 * `firstRun` adds the introduction and the two dismissals. Everything below that
 * line is identical, which is the point of having one component.
 */
export function openDictionarySetup(options: { firstRun?: boolean } = {}): void {
  if (open?.isConnected) {
    open.showModal();
    return;
  }
  ensureStyles();
  const firstRun = options.firstRun === true;

  const dialog = document.createElement("dialog");
  dialog.className = `kashiyomi-setup ${UI_ROOT_CLASS}`;
  open = dialog;

  const title = document.createElement("div");
  title.className = "ks-title";
  title.textContent = "Kashiyomi（歌詞読み）";
  dialog.appendChild(title);

  // No pitch, and **first run only**. Opened from Manage this is a dictionary
  // manager, where a line about API keys is advice nobody asked for; opened on
  // a fresh install it is the one place the two things needing setup can be
  // named at all.
  if (firstRun) {
    const need = document.createElement("div");
    need.className = "ks-need";
    need.textContent = t("setupNeedsDictionary");
    dialog.appendChild(need);
  }

  // The same card-of-rows the settings panel is built from, rather than a
  // second list idiom that happens to look similar.
  const list = document.createElement("div");
  list.className = "kc-card";
  dialog.appendChild(list);

  const radios = new Map<DictionaryEdition, HTMLInputElement>();
  const states = new Map<DictionaryEdition, HTMLElement>();
  for (const edition of OFFERED) {
    const label = document.createElement("label");
    label.className = "kc-row ks-option";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "kashiyomi-edition";
    radio.value = edition;
    radio.onchange = () => {
      updateSettings({ dictPreferredEdition: edition });
      // A finished job describes the edition it ran for, so choosing another
      // makes it stale. Left in place its cooldown also disabled the button,
      // which read as the dialog lagging behind the click.
      clearFinishedJob();
      paint();
    };
    radios.set(edition, radio);
    label.appendChild(radio);

    const body = document.createElement("div");
    body.className = "ks-option-body";
    const head = document.createElement("div");
    head.className = "kc-label";
    head.textContent = editionHeading(edition);
    body.appendChild(head);
    const note = document.createElement("div");
    note.className = "kc-desc";
    note.textContent = editionNote(edition);
    body.appendChild(note);
    label.appendChild(body);

    // Which edition is installed, and which one the analyzer actually has open,
    // shown on the options rather than asserted underneath them. The status
    // line used to carry it and produced "full installed" while core was
    // selected: true, and about a different edition than the one pointed at.
    const state = document.createElement("span");
    state.className = "ks-option-state";
    states.set(edition, state);
    label.appendChild(state);

    list.appendChild(label);
  }

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

  // `Later` and `Never` only on first run. From settings the dialog is something
  // the user opened on purpose, so the only sensible dismissal is closing it.
  const close = document.createElement("button");
  close.className = "kc-button";
  close.textContent = firstRun ? t("setupLater") : t("setupClose");
  close.onclick = () => {
    if (firstRun) updateSettings({ dictSetupSeen: "later" });
    dialog.close();
  };
  actions.appendChild(close);

  if (firstRun) {
    const never = document.createElement("button");
    never.className = "kc-button";
    never.textContent = t("setupNever");
    never.onclick = () => {
      // The settings row stays the way back in, which is what makes this safe
      // to offer rather than a decision the user cannot undo.
      updateSettings({ dictSetupSeen: "never" });
      dialog.close();
    };
    actions.appendChild(never);
  }

  let freeBytes = readFreeSpace();

  const paint = (): void => {
    if (freeBytes === undefined) freeBytes = readFreeSpace();
    const preferred = getSettings().dictPreferredEdition;
    const view = dictionaryRowState({
      preferred,
      inventory: dictionaryInventory(),
      job: dictionaryJob(),
      now: Date.now(),
      freeBytes,
    });

    const inventory = dictionaryInventory();
    for (const [edition, radio] of radios) {
      radio.checked = edition === preferred;
      radio.disabled = !view.pickerEnabled;
      radio.parentElement?.classList.toggle("kc-inert", !view.pickerEnabled);
      const state = states.get(edition);
      if (state) {
        const status = editionStatus(edition, inventory);
        state.textContent = editionStatusLabel(status);
        state.classList.toggle("ks-in-use", status === "in-use");
      }
    }

    // Hidden once something is running: it answers "will this fit", which is a
    // question about a download that has already started.
    space.textContent =
      freeBytes === undefined || view.settling
        ? ""
        : t("setupSpace")
            .replace("{needed}", mb(requiredFreeBytes(pinnedRelease(preferred).size)))
            .replace("{free}", size(freeBytes));

    status.textContent = describe(view.message);
    status.className = `ks-status ks-${view.dot}`;

    primary.textContent = actionLabel(view.primary.action);
    primary.disabled = view.primary.disabled;
    cancel.style.display = view.cancel.shown ? "" : "none";
    cancel.disabled = view.cancel.disabled;

    // Once a dictionary is in place the dialog has done its job, so the way out
    // stops being a deferral and becomes an ordinary close.
    if (firstRun && dictionaryInventory().installed.length > 0) {
      close.textContent = t("setupClose");
    }
    if (view.settling) startPolling();
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
      const settling = dictionaryRowState({
        preferred: getSettings().dictPreferredEdition,
        inventory: dictionaryInventory(),
        job: dictionaryJob(),
        now: Date.now(),
        freeBytes,
      }).settling;
      paint();
      if (!settling) stopPolling();
    }, 300);
  };

  primary.onclick = () => {
    const preferred = getSettings().dictPreferredEdition;
    const view = dictionaryRowState({
      preferred,
      inventory: dictionaryInventory(),
      job: dictionaryJob(),
      now: Date.now(),
      freeBytes,
    });
    startPolling();
    void startDictionaryInstall(actionEdition(view.primary.action, preferred)).then(() => {
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
    if (firstRun && getSettings().dictSetupSeen === "") {
      updateSettings({ dictSetupSeen: "later" });
    }
    dialog.remove();
    if (open === dialog) open = undefined;
  });

  document.body.appendChild(dialog);
  paint();
  dialog.showModal();

  // Check for a newer release as the dialog appears, rather than waiting for a
  // press. Without it the row could only ever repeat whatever the last manual
  // check found, which is how "already the newest release" came to be shown on
  // opening settings by something that had checked nothing.
  //
  // Silent on failure: opening a dialog must not produce an error nobody asked
  // for, and `resolveRelease` already falls back to the pinned release and
  // reports `checked: false`, which the row reads as "do not claim to know".
  if (dictionaryInventory().installed.length > 0) {
    void checkForNewerRelease(getSettings().dictPreferredEdition);
  }
}
