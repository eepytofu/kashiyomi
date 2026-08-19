import {
  DICTIONARY_EDITIONS,
  pinnedRelease,
  type DictionaryEdition,
} from "../../engine/dictionarySource.ts";
import {
  editionViewState,
  installedEdition,
  type DictionaryErrorCode,
  type DictionarySnapshot,
} from "../../engine/dictionaryState.ts";
import {
  activateDictionary,
  cancelDictionary,
  dictionarySnapshot,
  installDictionary,
  onDictionaryChange,
  removeDictionary,
} from "../dictionary.ts";
import {
  t,
  tDictionaryError,
  tDictionaryOperation,
  tDictionaryPhase,
  tf,
} from "../i18n.ts";
import { getSettings, updateSettings } from "../settings.ts";
import { applyUiTheme, liveRegion, uiButton, uiId } from "../uiPrimitives.ts";
import { ensureSharedStyles, UI_ROOT_CLASS } from "../uiStyles.ts";
import { SETUP_CSS } from "./styles.ts";
import {
  dictionaryDialogView,
  dictionaryEditionAction,
  type DictionaryEditionAction,
  type DictionaryUiError,
} from "./viewState.ts";

type CommandResult<T> = { readonly ok: true; readonly value: T } | {
  readonly ok: false;
  readonly errorCode: DictionaryErrorCode;
};

const DICTIONARY_ERRORS: ReadonlySet<string> = new Set([
  "notConfigured", "busy", "notInstalled", "diskSpace", "offline", "http",
  "archiveSize", "archiveHash", "archiveInvalid", "dictionarySize", "dictionaryHash",
  "dictionaryMissing", "loadFailed", "deleteFailed", "manifest", "io", "unsupported",
]);

function dictionaryCommand<T>(result: { readonly ok: true; readonly value: T } | {
  readonly ok: false;
  readonly errorCode: string;
}): CommandResult<T> {
  if (result.ok) return result;
  return { ok: false, errorCode: DICTIONARY_ERRORS.has(result.errorCode) ? result.errorCode as DictionaryErrorCode : "io" };
}

export type DictionaryDialogDependencies = {
  readonly snapshot: () => DictionarySnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly install: (edition: DictionaryEdition) => CommandResult<number>;
  readonly activate: (edition: DictionaryEdition) => CommandResult<number>;
  readonly remove: (edition: DictionaryEdition) => CommandResult<number>;
  readonly cancel: (operationId: number) => CommandResult<boolean>;
  readonly setupAnswered: () => boolean;
  readonly acknowledgeSetup: () => void;
};

type EditionNodes = {
  readonly row: HTMLElement;
  readonly radio: HTMLInputElement;
  readonly state: HTMLElement;
  readonly primary: HTMLButtonElement;
  readonly remove: HTMLButtonElement;
};

export type DictionaryDialogController = {
  readonly dialog: HTMLDialogElement;
  readonly refresh: () => void;
  readonly destroy: () => void;
};

const REAL_DEPENDENCIES: DictionaryDialogDependencies = {
  snapshot: dictionarySnapshot,
  subscribe: onDictionaryChange,
  install: (edition) => dictionaryCommand(installDictionary(edition)),
  activate: (edition) => dictionaryCommand(activateDictionary(edition)),
  remove: (edition) => dictionaryCommand(removeDictionary(edition)),
  cancel: (operationId) => dictionaryCommand(cancelDictionary(operationId)),
  setupAnswered: () => getSettings().dictSetupAnswered,
  acknowledgeSetup: () => updateSettings({ dictSetupAnswered: true }),
};

let openController: DictionaryDialogController | undefined;

function ensureStyles(): void {
  ensureSharedStyles();
  if (document.getElementById("kashiyomi-dictionary-css")) return;
  const style = document.createElement("style");
  style.id = "kashiyomi-dictionary-css";
  style.textContent = SETUP_CSS;
  document.head.appendChild(style);
}

function bytes(value: number): string {
  const mib = value / 1024 / 1024;
  return `${mib >= 100 ? Math.round(mib) : mib.toFixed(1)} MB`;
}

function editionName(edition: DictionaryEdition): string {
  return t(edition === "core" ? "dictEditionCore" : "dictEditionFull");
}

function primaryCopy(action: DictionaryEditionAction): string {
  if (action === "install-use") return t("dictActionInstallUse");
  if (action === "update-use") return t("dictActionUpdateUse");
  if (action === "update") return t("dictActionUpdate");
  return t("dictActionUse");
}

function setHidden(element: HTMLElement, hidden: boolean): void {
  element.hidden = hidden;
}

function focusable(dialog: HTMLDialogElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(
    "button:not([disabled]):not([hidden]), input:not([disabled]):not([hidden]), [tabindex]:not([tabindex='-1']):not([hidden])",
  )).filter((element) => !element.closest<HTMLElement>("[hidden]"));
}

/** Build the dialog once. Native polling calls refresh without replacing its controls. */
export function createDictionaryDialog(
  options: { readonly firstRun?: boolean } = {},
  dependencies: DictionaryDialogDependencies = REAL_DEPENDENCIES,
): DictionaryDialogController {
  ensureStyles();
  const firstRun = options.firstRun === true;
  let selected: DictionaryEdition = dependencies.snapshot().active ?? "core";
  let confirmRemove: DictionaryEdition | undefined;
  let commandError: DictionaryUiError | undefined;
  let pendingOperationId: number | undefined;
  let acceptedOperationId: number | undefined;
  let cancellingOperationId: number | undefined;
  let restoreAfterRemove: HTMLElement | undefined;

  const dialog = document.createElement("dialog");
  dialog.className = `kashiyomi-dictionary-dialog ${UI_ROOT_CLASS}`;
  applyUiTheme(dialog);

  const titleId = uiId("dictionary-title");
  const introId = uiId("dictionary-description");
  dialog.setAttribute("aria-labelledby", titleId);
  dialog.setAttribute("aria-describedby", introId);

  const header = document.createElement("header");
  header.className = "kd-header";
  const title = document.createElement("h2");
  title.id = titleId;
  title.className = "kd-title";
  title.tabIndex = -1;
  header.appendChild(title);
  const headerClose = uiButton("×", { variant: "quiet", className: "kd-header-close", ariaLabel: t("dictActionClose") });
  headerClose.onclick = () => dialog.close();
  header.appendChild(headerClose);
  dialog.appendChild(header);

  const intro = document.createElement("p");
  intro.id = introId;
  intro.className = "kd-intro";
  dialog.appendChild(intro);

  const list = document.createElement("fieldset");
  list.className = "kd-list";
  const legend = document.createElement("legend");
  legend.className = "kui-sr-only";
  legend.textContent = t("dictionary");
  list.appendChild(legend);
  const editions = new Map<DictionaryEdition, EditionNodes>();

  for (const edition of DICTIONARY_EDITIONS) {
    const release = pinnedRelease(edition);
    const row = document.createElement("div");
    row.className = "kd-edition";
    row.dataset.edition = edition;

    const choice = document.createElement("label");
    choice.className = "kd-choice";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "kashiyomi-dictionary-edition";
    radio.value = edition;
    radio.onchange = () => {
      selected = edition;
      commandError = undefined;
      refresh();
    };
    choice.appendChild(radio);
    const details = document.createElement("span");
    details.className = "kd-details";
    const name = document.createElement("span");
    name.className = "kd-name";
    name.textContent = editionName(edition);
    details.appendChild(name);
    const description = document.createElement("span");
    description.className = "kd-desc";
    description.textContent = t(edition === "core" ? "dictEditionCoreDesc" : "dictEditionFullDesc");
    details.appendChild(description);
    const sizes = document.createElement("span");
    sizes.className = "kd-size";
    sizes.textContent = `${t("dictDownloadSize")} ${bytes(release.sources[0]!.archiveBytes)} · ${t("dictDiskSize")} ${bytes(release.dictionaryBytes)}`;
    details.appendChild(sizes);
    choice.appendChild(details);
    row.appendChild(choice);

    const side = document.createElement("div");
    side.className = "kd-side";
    const state = document.createElement("span");
    state.className = "kd-state";
    side.appendChild(state);
    const actions = document.createElement("div");
    actions.className = "kd-row-actions";
    const primary = uiButton("", { variant: "primary" });
    actions.appendChild(primary);
    const remove = uiButton("", { variant: "danger" });
    remove.onclick = () => {
      confirmRemove = edition;
      commandError = undefined;
      restoreAfterRemove = remove;
      refresh();
      window.setTimeout(() => footerSecondary.focus(), 0);
    };
    actions.appendChild(remove);
    side.appendChild(actions);
    row.appendChild(side);
    list.appendChild(row);
    editions.set(edition, { row, radio, state, primary, remove });
  }
  dialog.appendChild(list);

  const removeView = document.createElement("section");
  removeView.className = "kd-confirm";
  const removeSummary = document.createElement("p");
  removeSummary.className = "kd-confirm-summary";
  removeView.appendChild(removeSummary);
  const removeConsequence = document.createElement("p");
  removeConsequence.className = "kd-help";
  removeView.appendChild(removeConsequence);
  dialog.appendChild(removeView);

  const progress = document.createElement("section");
  progress.className = "kd-progress";
  const progressHeading = document.createElement("div");
  progressHeading.className = "kd-progress-heading";
  progress.appendChild(progressHeading);
  const progressHead = document.createElement("div");
  progressHead.className = "kd-progress-head";
  const phase = document.createElement("span");
  const percent = document.createElement("span");
  progressHead.append(phase, percent);
  progress.appendChild(progressHead);
  const track = document.createElement("div");
  track.className = "kd-track";
  track.setAttribute("role", "progressbar");
  const bar = document.createElement("div");
  bar.className = "kd-bar";
  track.appendChild(bar);
  progress.appendChild(track);
  dialog.appendChild(progress);

  const feedback = liveRegion("kd-feedback");
  dialog.appendChild(feedback);

  const footer = document.createElement("footer");
  footer.className = "kd-footer";
  const footerPrimary = uiButton("", { variant: "primary", className: "kd-footer-action" });
  const footerCancelOperation = uiButton("", { className: "kd-footer-action" });
  const footerSecondary = uiButton("", { className: "kd-footer-action" });
  footer.append(footerPrimary, footerCancelOperation, footerSecondary);
  dialog.appendChild(footer);

  function accept(result: CommandResult<number>, acknowledge: boolean): void {
    if (!result.ok) {
      commandError = result.errorCode;
      pendingOperationId = undefined;
      refresh();
      return;
    }
    pendingOperationId = result.value;
    acceptedOperationId = result.value;
    commandError = undefined;
    if (acknowledge) dependencies.acknowledgeSetup();
    refresh();
  }

  function runEditionAction(edition: DictionaryEdition, action: DictionaryEditionAction, acknowledge: boolean): void {
    if (action === "use") accept(dependencies.activate(edition), acknowledge);
    else accept(dependencies.install(edition), acknowledge);
  }

  function leaveFirstRun(): void {
    if (firstRun && !dependencies.setupAnswered()) dependencies.acknowledgeSetup();
    dialog.close();
  }

  function refresh(): void {
    applyUiTheme(dialog);
    const snapshot = dependencies.snapshot();
    if (pendingOperationId !== undefined && snapshot.operation?.id === pendingOperationId) pendingOperationId = undefined;
    if (cancellingOperationId !== undefined && snapshot.operation?.id === cancellingOperationId && snapshot.operation.state !== "running") {
      cancellingOperationId = undefined;
    }
    if (snapshot.operation?.state === "succeeded") commandError = undefined;
    const view = dictionaryDialogView(snapshot, { firstRun, selected, confirmRemove, commandError });
    const running = snapshot.operation?.state === "running";
    const busy = running || pendingOperationId !== undefined;

    title.textContent = view.kind === "remove"
      ? t("dictRemoveTitle")
      : firstRun ? t("dictDialogSetupTitle") : t("dictionary");
    intro.textContent = firstRun ? t("dictDialogIntro") : "";
    setHidden(intro, !firstRun || view.kind === "remove");
    setHidden(headerClose, firstRun || view.kind === "remove");
    setHidden(list, view.kind === "remove");
    setHidden(removeView, view.kind !== "remove");

    for (const edition of DICTIONARY_EDITIONS) {
      const nodes = editions.get(edition)!;
      const state = editionViewState(snapshot, edition);
      nodes.radio.hidden = !firstRun;
      nodes.radio.checked = selected === edition;
      nodes.radio.disabled = busy;
      nodes.row.classList.toggle("kd-selectable", firstRun);
      nodes.state.classList.toggle("kd-state-active", state === "in-use");
      nodes.state.textContent = state === "in-use" ? t("dictStatusInUse")
        : state === "installed" ? t("dictStatusInstalled")
          : state === "update-available" ? t("dictStatusUpdate") : t("dictStatusMissing");

      const action = dictionaryEditionAction(snapshot, edition);
      setHidden(nodes.primary, firstRun || action === undefined);
      if (action) {
        nodes.primary.textContent = primaryCopy(action);
        nodes.primary.disabled = busy;
        nodes.primary.onclick = () => runEditionAction(edition, action, false);
      }
      const installed = installedEdition(snapshot, edition);
      setHidden(nodes.remove, firstRun || !installed);
      nodes.remove.textContent = t("dictActionRemove");
      nodes.remove.disabled = busy;
    }

    if (view.kind === "remove") {
      const installed = installedEdition(snapshot, view.edition);
      removeSummary.textContent = `${editionName(view.edition)} · ${tf("dictRemoveFrees", { size: bytes(installed?.dictionaryBytes ?? 0) })}`;
      removeConsequence.textContent = view.fallback
        ? tf("dictRemoveFallback", { edition: editionName(view.fallback) })
        : view.stopsAnnotation ? t("dictRemoveLast") : "";
    }

    setHidden(progress, view.kind !== "progress");
    if (view.kind === "progress") {
      const operation = view.operation;
      progressHeading.textContent = tDictionaryOperation(operation.kind, operation.edition ? editionName(operation.edition) : undefined);
      phase.textContent = tDictionaryPhase(operation.phase);
      const ratio = operation.total > 0 ? Math.min(1, operation.done / operation.total) : 0;
      percent.textContent = operation.total > 0 ? `${Math.round(ratio * 100)}%` : "";
      track.setAttribute("aria-valuemin", "0");
      track.setAttribute("aria-valuemax", String(operation.total || 1));
      track.setAttribute("aria-valuenow", String(operation.done));
      track.setAttribute("aria-valuetext", `${tDictionaryPhase(operation.phase)}${percent.textContent ? ` · ${percent.textContent}` : ""}`);
      bar.classList.toggle("kd-bar-indeterminate", operation.total === 0);
      bar.style.width = operation.total > 0 ? `${ratio * 100}%` : "18%";
    }

    if (commandError) feedback.textContent = tDictionaryError(commandError);
    else if (view.kind === "failure") feedback.textContent = tDictionaryError(view.errorCode);
    else if (view.kind === "cancelled") feedback.textContent = t("dictOperationCancelled");
    else if (acceptedOperationId !== undefined && snapshot.operation?.id === acceptedOperationId && snapshot.operation.state === "succeeded") {
      feedback.textContent = snapshot.operation.edition
        ? tf(snapshot.operation.kind === "remove" ? "dictRemoved" : "dictReady", { edition: editionName(snapshot.operation.edition) }) : "";
    } else feedback.textContent = "";
    feedback.classList.toggle("kd-feedback-error", commandError !== undefined || view.kind === "failure");

    setHidden(footerPrimary, true);
    setHidden(footerCancelOperation, true);
    setHidden(footerSecondary, true);

    if (view.kind === "remove") {
      setHidden(footerPrimary, false);
      footerPrimary.textContent = t("dictRemoveConfirm");
      footerPrimary.disabled = busy;
      footerPrimary.onclick = () => {
        const result = dependencies.remove(view.edition);
        if (result.ok) confirmRemove = undefined;
        accept(result, false);
      };
      setHidden(footerSecondary, false);
      footerSecondary.textContent = t("dictActionCancel");
      footerSecondary.onclick = () => {
        confirmRemove = undefined;
        refresh();
        window.setTimeout(() => restoreAfterRemove?.focus(), 0);
      };
    } else {
      const selectedAction = dictionaryEditionAction(snapshot, selected);
      if (firstRun && selectedAction && !running) {
        setHidden(footerPrimary, false);
        footerPrimary.textContent = selectedAction === "use"
          ? t("dictActionUse") : tf("dictInstallSelected", { edition: editionName(selected) });
        footerPrimary.disabled = busy;
        footerPrimary.onclick = () => runEditionAction(selected, selectedAction, true);
      }
      if (view.kind === "progress" && view.operation.cancellable) {
        setHidden(footerCancelOperation, false);
        const cancelling = cancellingOperationId === view.operation.id;
        footerCancelOperation.textContent = cancelling ? t("dictActionCancelling") : t("dictActionCancel");
        footerCancelOperation.disabled = cancelling;
        footerCancelOperation.onclick = () => {
          const result = dependencies.cancel(view.operation.id);
          if (!result.ok) commandError = result.errorCode;
          else if (!result.value) commandError = "cancelUnavailable";
          else cancellingOperationId = view.operation.id;
          refresh();
        };
      }
      if (firstRun || view.kind === "progress" || view.kind === "failure" || view.kind === "cancelled") {
        setHidden(footerSecondary, false);
        footerSecondary.textContent = firstRun && !dependencies.setupAnswered() ? t("dictActionLater") : t("dictActionClose");
        footerSecondary.onclick = leaveFirstRun;
      }
    }
    setHidden(footer, !Array.from(footer.children).some((child) => !(child as HTMLElement).hidden));
  }

  const unsubscribe = dependencies.subscribe(refresh);
  let destroyed = false;
  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    unsubscribe();
    dialog.remove();
  }

  dialog.addEventListener("cancel", (event) => {
    if (confirmRemove) {
      event.preventDefault();
      confirmRemove = undefined;
      refresh();
      window.setTimeout(() => restoreAfterRemove?.focus(), 0);
      return;
    }
    if (firstRun && !dependencies.setupAnswered()) dependencies.acknowledgeSetup();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const items = focusable(dialog);
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  refresh();
  return { dialog, refresh, destroy };
}

export function openDictionarySetup(options: { readonly firstRun?: boolean } = {}): void {
  if (openController?.dialog.isConnected) {
    if (!openController.dialog.open) openController.dialog.showModal();
    openController.dialog.focus();
    return;
  }
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  const controller = createDictionaryDialog(options);
  openController = controller;
  document.body.appendChild(controller.dialog);
  controller.dialog.addEventListener("close", () => {
    controller.destroy();
    if (openController === controller) openController = undefined;
    opener?.focus();
  }, { once: true });
  controller.dialog.showModal();
  const initial = controller.dialog.querySelector<HTMLElement>("input:checked:not([hidden]), button:not([hidden])");
  window.setTimeout(() => initial?.focus(), 0);
}
