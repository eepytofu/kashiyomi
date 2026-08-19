// Compact dictionary setup and management dialog.

import { dictionaryRowState } from "../../engine/dictionaryRowState.ts";
import { pinnedRelease } from "../../engine/dictionaryPins.ts";
import { requiredFreeBytes, type DictionaryEdition } from "../../engine/dictionarySource.ts";
import { currentAssetPaths } from "../annotator.ts";
import {
  cancelDictionaryDownload,
  dictionaryInventory,
  dictionaryJob,
  onDictionaryChange,
} from "../dictionary.ts";
import { startDictionaryInstall } from "../dictionaryInstall.ts";
import { describe, mb, size } from "../dictionaryText.ts";
import { t } from "../i18n.ts";
import { nativeFreeSpace } from "../native.ts";
import { getSettings, updateSettings } from "../settings.ts";
import { UI_ROOT_CLASS, ensureSharedStyles } from "../uiStyles.ts";
import { SETUP_CSS } from "./styles.ts";

const OFFERED: readonly DictionaryEdition[] = ["core", "full"];
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

function isWorking(): boolean {
  const kind = dictionaryJob().kind;
  return kind === "resolving" || kind === "downloading" || kind === "installing";
}

function cancellable(): boolean {
  const job = dictionaryJob();
  if (job.kind === "downloading") return true;
  return job.kind === "installing" && (job.phase === "verifying" || job.phase === "extracting");
}

/** Show the dialog, or bring an existing one forward. */
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
  title.textContent = firstRun ? "Kashiyomi（歌詞読み）" : t("dictionary");
  dialog.appendChild(title);

  if (firstRun) {
    const need = document.createElement("div");
    need.className = "ks-need";
    need.textContent = t("setupNeedsDictionary");
    dialog.appendChild(need);
  }

  const list = document.createElement("div");
  list.className = "kc-card ks-options";
  dialog.appendChild(list);

  let selected: DictionaryEdition = dictionaryInventory().edition ?? "core";
  let completedHere = false;
  const radios = new Map<DictionaryEdition, HTMLInputElement>();
  const states = new Map<DictionaryEdition, HTMLElement>();

  for (const edition of OFFERED) {
    const label = document.createElement("label");
    label.className = "kc-row ks-option";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "kashiyomi-dictionary-edition";
    radio.value = edition;
    radio.onchange = () => {
      selected = edition;
      completedHere = false;
      paint();
    };
    radios.set(edition, radio);
    label.appendChild(radio);

    const body = document.createElement("div");
    body.className = "ks-option-body";
    const heading = document.createElement("div");
    heading.className = "kc-label";
    heading.textContent = edition === "core" ? t("dictEditionCore") : t("dictEditionFull");
    body.appendChild(heading);
    const note = document.createElement("div");
    note.className = "kc-desc";
    note.textContent =
      edition === "core" ? t("dictEditionCoreDesc") : t("dictEditionFullDesc");
    body.appendChild(note);
    label.appendChild(body);

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

  const spacer = document.createElement("div");
  spacer.className = "ks-spacer";
  actions.appendChild(spacer);

  const close = document.createElement("button");
  close.className = "kc-button";
  close.textContent =
    firstRun && !dictionaryInventory().installed ? t("setupLater") : t("setupClose");
  close.onclick = () => dialog.close();
  actions.appendChild(close);

  let freeBytes = readFreeSpace();

  const paint = (): void => {
    if (freeBytes === undefined) freeBytes = readFreeSpace();
    const inventory = dictionaryInventory();
    const working = isWorking();
    const active = inventory.edition;

    for (const edition of OFFERED) {
      const radio = radios.get(edition);
      if (radio) {
        radio.checked = edition === selected;
        radio.disabled = working;
        radio.parentElement?.classList.toggle("kc-inert", working);
      }
      const state = states.get(edition);
      if (state) {
        state.textContent = edition === active ? t("dictEditionInUse") : "";
        state.classList.toggle("ks-in-use", edition === active);
      }
    }

    const needed = requiredFreeBytes(pinnedRelease(selected).size);
    space.textContent =
      working || freeBytes === undefined
        ? ""
        : t("setupSpace").replace("{needed}", mb(needed)).replace("{free}", size(freeBytes));

    if (working) {
      status.textContent = describe(
        dictionaryRowState({
          inventory,
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

    if (completedHere && active === selected) {
      status.textContent = t("setupInstalled");
      status.className = "ks-status ks-ready";
      primary.textContent = t("setupDone");
      primary.disabled = false;
      close.textContent = t("setupClose");
      return;
    }

    const heading = selected === "core" ? t("dictEditionCore") : t("dictEditionFull");
    status.textContent =
      active === selected
        ? `${heading} · ${t("dictInstalledState")}`
        : inventory.installed
          ? `${heading} · ${t("dictNotInstalled")}`
          : describe({ kind: "absent", version: pinnedRelease(selected).version });
    status.className = `ks-status ${active === selected ? "ks-ready" : ""}`;
    primary.textContent =
      active === selected
        ? t("dictUpdate")
        : inventory.installed
          ? t("dictSwitch")
          : t("dictInstall");
    primary.disabled = freeBytes !== undefined && freeBytes < needed;
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
      const working = isWorking();
      paint();
      if (!working) stopPolling();
    }, 300);
  };

  primary.onclick = () => {
    if (isWorking()) {
      if (cancellable()) cancelDictionaryDownload();
      return;
    }
    if (completedHere && dictionaryInventory().edition === selected) {
      dialog.close();
      return;
    }
    startPolling();
    void startDictionaryInstall(selected).then(() => {
      freeBytes = readFreeSpace();
      completedHere = dictionaryInventory().edition === selected;
      paint();
    });
  };

  const unsubscribe = onDictionaryChange(paint);
  dialog.addEventListener("close", () => {
    unsubscribe();
    stopPolling();
    if (firstRun && !getSettings().dictSetupAnswered) {
      updateSettings({ dictSetupAnswered: true });
    }
    dialog.remove();
    if (open === dialog) open = undefined;
  });

  document.body.appendChild(dialog);
  paint();
  dialog.showModal();
}
