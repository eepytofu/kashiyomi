import {
  DICTIONARY_EDITIONS,
  pinnedRelease,
  type DictionaryEdition,
} from "../../engine/dictionarySource.ts";
import {
  editionViewState,
  installedEdition,
  type DictionaryErrorCode,
  type DictionaryOperation,
} from "../../engine/dictionaryState.ts";
import {
  activateDictionary,
  cancelDictionary,
  dictionarySnapshot,
  installDictionary,
  onDictionaryChange,
  removeDictionary,
} from "../dictionary.ts";
import { panelLang, t } from "../i18n.ts";
import { getSettings, updateSettings } from "../settings.ts";
import { UI_ROOT_CLASS } from "../uiStyles.ts";
import { SETUP_CSS } from "./styles.ts";
import { dictionaryDialogView } from "./viewState.ts";

let openDialog: HTMLDialogElement | undefined;

type Copy = {
  intro: string; download: string; installed: string; inUse: string; notInstalled: string;
  installedState: string; update: string; installUse: string; use: string; remove: string;
  later: string; close: string; cancel: string; removing: string; removeTitle: string;
  fallback: (name: string) => string; last: string; frees: (size: string) => string;
  install: (name: string) => string; phases: Record<DictionaryOperation["phase"], string>;
  cancelled: string; errors: Record<DictionaryErrorCode, string>;
};

function copy(): Copy {
  if (panelLang() === "zh") return {
    intro: "Core 为默认推荐。词典不会随插件打包，可稍后安装。",
    download: "下载", installed: "安装后", inUse: "使用中", notInstalled: "未安装",
    installedState: "已安装", update: "有可用更新", installUse: "安装并使用", use: "使用",
    remove: "移除…", later: "暂时跳过", close: "关闭", cancel: "取消", removing: "确认移除",
    removeTitle: "移除词典？", fallback: (name) => `移除后将自动改用 ${name}。`,
    last: "这是最后一个词典。移除后，日语歌词注音将停止。", frees: (size) => `将释放约 ${size}。`,
    install: (name) => `安装 ${name}`, cancelled: "操作已取消。",
    phases: { starting: "准备中", connecting: "正在连接", downloading: "正在下载", extracting: "正在解压", validating: "正在校验", activating: "正在启用", cleaning: "正在清理" },
    errors: { notConfigured: "词典服务尚未就绪。", busy: "已有词典操作正在进行。", notInstalled: "该词典未安装。", diskSpace: "磁盘空间不足。", offline: "无法连接下载源。", http: "下载源返回错误。", archiveSize: "下载文件大小不符。", archiveHash: "下载文件校验失败。", archiveInvalid: "无法读取下载文件。", dictionarySize: "词典大小不符。", dictionaryHash: "词典校验失败。", dictionaryMissing: "压缩包中缺少词典。", loadFailed: "分析器无法加载该词典。", deleteFailed: "无法删除词典；安装记录保持不变。", manifest: "无法保存词典状态。", io: "磁盘操作失败。", unsupported: "此系统不支持原生下载。" },
  };
  return {
    intro: "Core is recommended by default. Dictionaries are downloaded at runtime and can be installed later.",
    download: "Download", installed: "Installed", inUse: "In use", notInstalled: "Not installed",
    installedState: "Installed", update: "Update available", installUse: "Install and use", use: "Use",
    remove: "Remove…", later: "Later", close: "Close", cancel: "Cancel", removing: "Remove",
    removeTitle: "Remove dictionary?", fallback: (name) => `${name} will be activated before this edition is removed.`,
    last: "This is the last dictionary. Japanese lyric annotation will stop after removal.", frees: (size) => `This will free about ${size}.`,
    install: (name) => `Install ${name}`, cancelled: "The operation was cancelled.",
    phases: { starting: "Starting", connecting: "Connecting", downloading: "Downloading", extracting: "Extracting", validating: "Validating", activating: "Activating", cleaning: "Cleaning" },
    errors: { notConfigured: "The dictionary service is not ready.", busy: "Another dictionary operation is already running.", notInstalled: "That dictionary is not installed.", diskSpace: "There is not enough disk space.", offline: "No download source could be reached.", http: "A download source returned an error.", archiveSize: "The download size did not match.", archiveHash: "The download failed verification.", archiveInvalid: "The downloaded archive could not be read.", dictionarySize: "The extracted dictionary size did not match.", dictionaryHash: "The extracted dictionary failed verification.", dictionaryMissing: "The archive did not contain the pinned dictionary.", loadFailed: "The analyzer could not load that dictionary.", deleteFailed: "The dictionary could not be deleted; its installed entry was retained.", manifest: "Dictionary state could not be saved.", io: "A disk operation failed.", unsupported: "Native download is unsupported on this system." },
  };
}

function ensureStyles(): void {
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

function button(label: string, className = ""): HTMLButtonElement {
  const element = document.createElement("button");
  element.className = `kd-button ${className}`.trim();
  element.textContent = label;
  return element;
}

export function openDictionarySetup(options: { firstRun?: boolean } = {}): void {
  if (openDialog?.isConnected) {
    if (!openDialog.open) openDialog.showModal();
    openDialog.focus();
    return;
  }
  ensureStyles();
  const firstRun = options.firstRun === true;
  let selected: DictionaryEdition = dictionarySnapshot().active ?? "core";
  let confirmRemove: DictionaryEdition | undefined;
  let commandError: DictionaryErrorCode | undefined;
  const dialog = document.createElement("dialog");
  dialog.className = `kashiyomi-dictionary-dialog ${UI_ROOT_CLASS}`;
  openDialog = dialog;

  const render = (): void => {
    const text = copy();
    const snapshot = dictionarySnapshot();
    const view = dictionaryDialogView(snapshot, { firstRun, selected, confirmRemove, commandError });
    dialog.textContent = "";
    const title = document.createElement("h2");
    title.className = "kd-title";
    title.textContent = confirmRemove ? text.removeTitle : firstRun ? "Kashiyomi（歌詞読み）" : t("dictionary");
    dialog.appendChild(title);

    if (view.kind === "remove") {
      const installed = installedEdition(snapshot, view.edition);
      const fallback = view.fallback;
      const body = document.createElement("div");
      body.className = "kd-confirm";
      const name = confirmRemove === "core" ? t("dictEditionCore") : t("dictEditionFull");
      const explanation = document.createElement("div");
      explanation.textContent = `${name} · ${installed ? text.frees(bytes(installed.dictionaryBytes)) : ""}`;
      body.appendChild(explanation);
      if (fallback || view.stopsAnnotation) {
        const help = document.createElement("div");
        help.className = "kd-help";
        help.textContent = fallback
          ? text.fallback(fallback === "core" ? t("dictEditionCore") : t("dictEditionFull"))
          : text.last;
        body.appendChild(help);
      }
      dialog.appendChild(body);
      const actions = document.createElement("div");
      actions.className = "kd-actions";
      const remove = button(text.removing, "kd-primary kd-large");
      remove.onclick = () => {
        const result = removeDictionary(confirmRemove!);
        if (!result.ok) commandError = result.errorCode as DictionaryErrorCode;
        else confirmRemove = undefined;
        render();
      };
      actions.appendChild(remove);
      const back = button(text.cancel, "kd-large kd-close");
      back.onclick = () => { confirmRemove = undefined; render(); };
      actions.appendChild(back);
      dialog.appendChild(actions);
      return;
    }

    if (firstRun) {
      const intro = document.createElement("div");
      intro.className = "kd-intro";
      intro.textContent = text.intro;
      dialog.appendChild(intro);
    }

    const list = document.createElement("div");
    list.className = "kd-list";
    const running = snapshot.operation?.state === "running";
    for (const edition of DICTIONARY_EDITIONS) {
      const release = pinnedRelease(edition);
      const installed = installedEdition(snapshot, edition);
      const state = editionViewState(snapshot, edition);
      const row = document.createElement("div");
      row.className = "kd-edition";
      const choice = document.createElement(firstRun ? "label" : "div");
      choice.className = "kd-choice";
      if (firstRun) {
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "kashiyomi-dictionary-edition";
        radio.checked = selected === edition;
        radio.disabled = running;
        radio.onchange = () => { selected = edition; commandError = undefined; render(); };
        choice.appendChild(radio);
      }
      const details = document.createElement("div");
      const name = document.createElement("div");
      name.className = "kd-name";
      name.textContent = edition === "core" ? t("dictEditionCore") : t("dictEditionFull");
      details.appendChild(name);
      const description = document.createElement("div");
      description.className = "kd-desc";
      description.textContent = edition === "core" ? t("dictEditionCoreDesc") : t("dictEditionFullDesc");
      details.appendChild(description);
      const sizes = document.createElement("div");
      sizes.className = "kd-size";
      sizes.textContent = `${text.download} ${bytes(release.sources[0]!.archiveBytes)} · ${text.installed} ${bytes(release.dictionaryBytes)}`;
      details.appendChild(sizes);
      choice.appendChild(details);
      row.appendChild(choice);
      const status = document.createElement("div");
      status.className = `kd-state ${state === "in-use" ? "kd-state-active" : ""}`;
      status.textContent = state === "in-use" ? text.inUse : state === "installed" ? text.installedState : state === "update-available" ? text.update : text.notInstalled;
      row.appendChild(status);
      if (!firstRun) {
        const actions = document.createElement("div");
        actions.className = "kd-row-actions";
        if (!installed || installed.updateAvailable) {
          const install = button(text.installUse, "kd-primary");
          install.disabled = running;
          install.onclick = () => {
            const result = installDictionary(edition);
            if (!result.ok) commandError = result.errorCode as DictionaryErrorCode;
            render();
          };
          actions.appendChild(install);
        } else if (snapshot.active !== edition) {
          const use = button(text.use, "kd-primary");
          use.disabled = running;
          use.onclick = () => {
            const result = activateDictionary(edition);
            if (!result.ok) commandError = result.errorCode as DictionaryErrorCode;
            render();
          };
          actions.appendChild(use);
        }
        if (installed) {
          const remove = button(text.remove, "kd-danger");
          remove.disabled = running;
          remove.onclick = () => { confirmRemove = edition; commandError = undefined; render(); };
          actions.appendChild(remove);
        }
        row.appendChild(actions);
      }
      list.appendChild(row);
    }
    dialog.appendChild(list);

    const operation = snapshot.operation;
    if (view.kind === "progress") {
      const runningOperation = view.operation;
      const progress = document.createElement("div");
      progress.className = "kd-progress";
      const head = document.createElement("div");
      head.className = "kd-progress-head";
      const phase = document.createElement("span");
      phase.textContent = text.phases[runningOperation.phase];
      head.appendChild(phase);
      const ratio = runningOperation.total > 0 ? Math.min(1, runningOperation.done / runningOperation.total) : 0;
      const percent = document.createElement("span");
      percent.textContent = runningOperation.total > 0 ? `${Math.round(ratio * 100)}%` : "";
      head.appendChild(percent);
      progress.appendChild(head);
      const track = document.createElement("div");
      track.className = "kd-track";
      const bar = document.createElement("div");
      bar.className = "kd-bar";
      bar.style.width = runningOperation.total > 0 ? `${ratio * 100}%` : "18%";
      track.appendChild(bar);
      progress.appendChild(track);
      dialog.appendChild(progress);
    } else if (view.kind === "failure") {
      const error = document.createElement("div");
      error.className = "kd-error";
      error.textContent = text.errors[view.errorCode];
      dialog.appendChild(error);
    } else if (view.kind === "cancelled") {
      const cancelled = document.createElement("div");
      cancelled.className = "kd-error";
      cancelled.textContent = text.cancelled;
      dialog.appendChild(cancelled);
    }

    const actions = document.createElement("div");
    actions.className = "kd-actions";
    if (view.kind === "first-run" && view.canInstallSelected) {
      const name = selected === "core" ? t("dictEditionCore") : t("dictEditionFull");
      const install = button(text.install(name), "kd-primary kd-large");
      install.disabled = running === true;
      install.onclick = () => {
        updateSettings({ dictSetupAnswered: true });
        const result = installDictionary(selected);
        if (!result.ok) commandError = result.errorCode as DictionaryErrorCode;
        render();
      };
      actions.appendChild(install);
    }
    if (operation?.state === "running" && operation.cancellable) {
      const cancel = button(text.cancel, firstRun ? "kd-large" : "");
      cancel.onclick = () => { cancelDictionary(operation.id); render(); };
      actions.appendChild(cancel);
    }
    const close = button(firstRun && !getSettings().dictSetupAnswered ? text.later : text.close, `${firstRun ? "kd-large " : ""}kd-close`);
    close.onclick = () => {
      if (firstRun && !getSettings().dictSetupAnswered) updateSettings({ dictSetupAnswered: true });
      dialog.close();
    };
    actions.appendChild(close);
    dialog.appendChild(actions);
  };

  const unsubscribe = onDictionaryChange(render);
  dialog.addEventListener("cancel", () => {
    if (firstRun && !getSettings().dictSetupAnswered) updateSettings({ dictSetupAnswered: true });
  });
  dialog.addEventListener("close", () => {
    unsubscribe();
    dialog.remove();
    if (openDialog === dialog) openDialog = undefined;
  });
  document.body.appendChild(dialog);
  render();
  dialog.showModal();
}
