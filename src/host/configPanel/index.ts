// The plugin manager settings panel. Plain DOM, no framework. Two columns:
// settings cards on the left, a live preview (rendered with the production
// line renderer) and an about card on the right.

import { rescan } from "../annotator.ts";
import { panelLang, setPanelLang, t, type PanelLang } from "../i18n.ts";
import { nativeState } from "../native.ts";
import { resetTranslation } from "../translationLane.ts";
import {
  DEFAULT_JP_FONT_STACK,
  DEFAULT_ZH_FONT_STACK,
  getSettings,
} from "../settings.ts";
import { PANEL_CSS } from "./css.ts";
import { dictionaryInventory, onDictionaryChange } from "../dictionary.ts";
import { dictionaryRow } from "./dictionaryRow.ts";
import { onPanelTeardown, teardownPanel } from "./lifecycle.ts";
import { buildPreviewCard } from "./preview.ts";
import {
  card,
  fontStackRow,
  readingOverridesRow,
  sectionTitle,
  sizeRow,
  textRow,
  toggleRow,
} from "./rows.ts";
import { apiKeysRow, clearCacheRow, providerRow, targetLangRow } from "./translationRows.ts";

const REPO_URL = "https://github.com/eepytofu/kashiyomi";

export function buildConfigPanel(): HTMLElement {
  const root = document.createElement("div");
  root.className = "kashiyomi-config";
  render(root);
  return root;
}

function render(root: HTMLElement): void {
  // A rebuild detaches every node below, so anything still subscribed or still
  // ticking is writing into a document it has left. Four paths reach this
  // function, so a row that does not clean up leaks once per visit.
  teardownPanel();
  root.textContent = "";
  const style = document.createElement("style");
  style.textContent = PANEL_CSS;
  root.appendChild(style);

  root.appendChild(buildStatusBar(root));

  const left = document.createElement("div");
  left.className = "kc-col";
  const right = document.createElement("div");
  right.className = "kc-col kc-col-side";

  const refreshPreview = buildPreviewCard(right);

  left.appendChild(sectionTitle(t("sectionJapanese")));
  const jp = card();
  jp.appendChild(dictionaryRow());
  const needsDictionary = document.createElement("div");
  needsDictionary.className = "kc-needs-dict";
  needsDictionary.textContent = t("dictNeededForThese");
  jp.appendChild(needsDictionary);
  // Exactly the settings that do nothing without a dictionary, which is not the
  // whole card. Font routing happens during classification (`applyScriptFont`),
  // before anything is analyzed, so the two font rows work with no dictionary at
  // all and greying them would misdescribe them.
  const inert = [
    toggleRow("furigana", t("furigana"), t("furiganaDesc"), refreshPreview),
    toggleRow("romaji", t("romaji"), t("romajiDesc"), refreshPreview),
    toggleRow("readingHints", t("hints"), t("hintsDesc"), refreshPreview),
    toggleRow("hanRepair", t("repair"), t("repairDesc"), refreshPreview),
    sizeRow(refreshPreview),
  ];
  for (const rowEl of inert) jp.appendChild(rowEl);
  jp.appendChild(toggleRow("useJpFont", t("jpFont"), t("jpFontDesc"), refreshPreview, false));
  jp.appendChild(fontStackRow("jpFontStack", DEFAULT_JP_FONT_STACK, "fontStack", "fontStackDesc", refreshPreview));
  // Last in the Japanese card: it is the escape hatch for when everything
  // above got a reading wrong, so it reads in the order someone reaches for it.
  const overrides = readingOverridesRow();
  jp.appendChild(overrides);
  inert.push(overrides);
  gateOnDictionary(inert, needsDictionary);
  left.appendChild(jp);

  left.appendChild(sectionTitle(t("sectionChinese")));
  const zh = card();
  zh.appendChild(toggleRow("pinyin", t("pinyin"), t("pinyinDesc"), refreshPreview));
  zh.appendChild(toggleRow("pinyinTones", t("tones"), t("tonesDesc"), refreshPreview));
  zh.appendChild(toggleRow("pinyinJoinWords", t("groupWords"), t("groupWordsDesc"), refreshPreview));
  zh.appendChild(toggleRow("useZhFont", t("zhFont"), t("zhFontDesc"), refreshPreview, false));
  zh.appendChild(fontStackRow("zhFontStack", DEFAULT_ZH_FONT_STACK, "zhFontStack", "fontStackDesc", refreshPreview));
  left.appendChild(zh);

  left.appendChild(sectionTitle(t("sectionAi")));
  const ai = card();
  ai.appendChild(toggleRow("aiAutoTranslate", t("aiAuto"), t("aiAutoDesc"), resetTranslation));
  ai.appendChild(providerRow(() => render(root)));
  // Gemini has a fixed Google endpoint; the base URL only applies to
  // OpenAI-compatible providers.
  if (getSettings().aiProvider === "openai") {
    ai.appendChild(textRow("aiBaseUrl", "aiBaseUrl", "aiBaseUrlDesc", { placeholder: "https://api.openai.com/v1" }));
  }
  ai.appendChild(apiKeysRow());
  ai.appendChild(
    textRow("aiModel", "aiModel", "aiModelDesc", {
      placeholder: getSettings().aiProvider === "gemini" ? "gemini-3.5-flash-lite" : "gpt-5.6-luna",
    }),
  );
  ai.appendChild(targetLangRow());
  ai.appendChild(textRow("aiCustomPrompt", "aiCustomPrompt", "aiCustomPromptDesc", {}));
  ai.appendChild(clearCacheRow());
  left.appendChild(ai);

  left.appendChild(sectionTitle(t("sectionAdvanced")));
  const adv = card();
  // Not under Japanese or Chinese: it governs the rows under both, and putting
  // it in either section would imply it only applies there.
  adv.appendChild(toggleRow("useRowFont", t("rowFont"), t("rowFontDesc"), refreshPreview, false));
  adv.appendChild(fontStackRow("rowFontStack", DEFAULT_JP_FONT_STACK, "rowFontStack", "fontStackDesc", refreshPreview));
  adv.appendChild(toggleRow("annotateCredits", t("credits"), t("creditsDesc")));
  adv.appendChild(toggleRow("debug", t("debug"), t("debugDesc"), () => {}));
  left.appendChild(adv);

  buildAboutCard(right);

  root.appendChild(left);
  root.appendChild(right);
}

/**
 * Grey out settings that cannot do anything until a dictionary exists, and say
 * so once above them.
 *
 * Disabled rather than hidden: a panel that changes shape when a download
 * finishes is disorienting, and the greyed rows are also the clearest statement
 * of what the dictionary is *for*. Disabled rather than merely dimmed, too,
 * because a toggle that looks inactive but still writes a setting lets someone
 * turn on furigana, see nothing happen, and have no way to tell which of the two
 * things is broken.
 *
 * Follows the inventory rather than being decided once: the dialog this panel
 * opens can install a dictionary without the panel being rebuilt.
 */
function gateOnDictionary(rows: readonly HTMLElement[], notice: HTMLElement): void {
  const paint = (): void => {
    const absent = dictionaryInventory().installed.length === 0;
    notice.style.display = absent ? "" : "none";
    for (const rowEl of rows) {
      rowEl.classList.toggle("kc-inert", absent);
      for (const control of rowEl.querySelectorAll("input, select, textarea, button")) {
        (control as HTMLInputElement).disabled = absent;
      }
    }
  };
  paint();
  onPanelTeardown(onDictionaryChange(paint));
}

function buildStatusBar(root: HTMLElement): HTMLElement {
  const bar = document.createElement("div");
  const label = document.createElement("span");
  const dot = document.createElement("span");
  dot.className = "kc-dot";

  const paint = (): string => {
    const s = nativeState();
    bar.className =
      "kc-status kc-full " +
      (s.state === "ready" ? "kc-ready" : s.state === "loading" ? "kc-loading" : "kc-bad");
    label.textContent = "";
    label.appendChild(dot);
    label.appendChild(document.createTextNode(
      s.state === "ready"
        ? t("analyzerReady")
        : s.state === "loading"
          ? t("analyzerLoading")
          : s.state === "uninitialized"
            ? t("analyzerNotStarted")
            : `${t("analyzerFailed")}${s.error ? `: ${s.error}` : ""}`,
    ));
    return s.state;
  };

  // Poll only while the answer can still change. `status` costs 0.044ms
  // (measured over 200 calls), so a ~10s load is under 1ms of work in total,
  // and steady state runs no timer at all.
  //
  // Live while the analyzer is still loading, because the status is otherwise
  // sampled once at build time: opening the panel during the dictionary load
  // showed "loading" and kept showing it after the load finished, the one
  // element whose job is reporting current state reporting a stale one.
  const initial = paint();
  if (initial === "loading" || initial === "uninitialized") {
    const statusPoll = window.setInterval(() => {
      const state = paint();
      if (state !== "loading" && state !== "uninitialized") window.clearInterval(statusPoll);
    }, 500);
    onPanelTeardown(() => window.clearInterval(statusPoll));
  }
  bar.appendChild(label);

  const rightSide = document.createElement("div");
  rightSide.className = "kc-status-right";
  const reannotate = document.createElement("button");
  reannotate.className = "kc-button";
  reannotate.textContent = t("reannotate");
  reannotate.onclick = () => {
    rescan();
    render(root);
  };
  rightSide.appendChild(reannotate);
  // Tried and rejected: moving this into a settings row under Advanced, which
  // is where a preference "belongs". Two things killed it. The segments wrap
  // (中文 broke onto two lines in the narrower row), and it lands 1500px down a
  // 2036px scroll — so someone who opens an English panel they cannot read must
  // scroll past every section they cannot read to reach the control that fixes
  // it. Visibility wins over categorical tidiness for this one control.
  rightSide.appendChild(buildLangToggle(root));
  bar.appendChild(rightSide);
  return bar;
}

function buildLangToggle(root: HTMLElement): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "kc-lang";
  // Sitting in the status bar with no label, this control does not say what it
  // changes; more than one reading of "EN / 中文" next to a lyrics plugin is
  // plausible. The settings-row experiment made the scope explicit and cost too
  // much elsewhere, so the wording survives as the hover text.
  wrap.title = t("panelLanguageDesc");
  const current = panelLang();
  const options: [PanelLang, string][] = [
    ["en", "EN"],
    ["zh", "中文"],
  ];
  for (const [lang, label] of options) {
    const button = document.createElement("button");
    button.textContent = label;
    if (lang === current) button.className = "kc-active";
    button.onclick = () => {
      setPanelLang(lang);
      render(root);
    };
    wrap.appendChild(button);
  }
  return wrap;
}

function buildAboutCard(column: HTMLElement): void {
  column.appendChild(sectionTitle(t("about")));
  const box = card();
  box.className += " kc-about";

  const name = document.createElement("div");
  const version = (plugin as { manifest?: { version?: string } }).manifest?.version ?? "";
  name.textContent = `Kashiyomi（歌詞読み）${version ? ` v${version}` : ""}`;
  box.appendChild(name);

  // Both links are required for listing: the store asks for the source and a
  // way to report a bug, each reachable from inside the plugin's own settings.
  const link = (label: string, url: string) => {
    const el = document.createElement("span");
    el.className = "kc-link";
    el.textContent = label;
    el.onclick = () => {
      try {
        betterncm.ncm.openUrl(url);
      } catch {
        window.open(url);
      }
    };
    box.appendChild(el);
  };
  link(t("aboutRepo"), REPO_URL);
  link(t("aboutIssues"), `${REPO_URL}/issues`);

  const logPath = document.createElement("div");
  logPath.className = "kc-muted";
  logPath.textContent = `${t("aboutLog")}: C:\\betterncm\\kashiyomi.log`;
  box.appendChild(logPath);

  column.appendChild(box);
}
