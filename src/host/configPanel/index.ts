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
import { buildPreviewCard } from "./preview.ts";
import { card, fontStackRow, sectionTitle, sizeRow, textRow, toggleRow } from "./rows.ts";
import { apiKeysRow, clearCacheRow, providerRow, targetLangRow } from "./translationRows.ts";

const REPO_URL = "https://github.com/eepytofu/kashiyomi";

export function buildConfigPanel(): HTMLElement {
  const root = document.createElement("div");
  root.className = "kashiyomi-config";
  render(root);
  return root;
}

function render(root: HTMLElement): void {
  root.textContent = "";
  const style = document.createElement("style");
  style.textContent = PANEL_CSS;
  root.appendChild(style);

  root.appendChild(buildStatusBar(root));

  const left = document.createElement("div");
  left.className = "kc-col";
  const right = document.createElement("div");
  right.className = "kc-col";

  const refreshPreview = buildPreviewCard(right);

  left.appendChild(sectionTitle(t("sectionJapanese")));
  const jp = card();
  jp.appendChild(toggleRow("furigana", t("furigana"), t("furiganaDesc"), refreshPreview));
  jp.appendChild(toggleRow("romaji", t("romaji"), t("romajiDesc"), refreshPreview));
  jp.appendChild(toggleRow("readingHints", t("hints"), t("hintsDesc"), refreshPreview));
  jp.appendChild(toggleRow("hanRepair", t("repair"), t("repairDesc")));
  jp.appendChild(sizeRow(refreshPreview));
  jp.appendChild(toggleRow("useJpFont", t("jpFont"), t("jpFontDesc"), refreshPreview, false));
  jp.appendChild(fontStackRow("jpFontStack", DEFAULT_JP_FONT_STACK, "fontStack", "fontStackDesc", refreshPreview));
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
      placeholder: getSettings().aiProvider === "gemini" ? "gemini-3.5-flash-lite" : "gpt-5.6-sol",
    }),
  );
  ai.appendChild(targetLangRow());
  ai.appendChild(textRow("aiCustomPrompt", "aiCustomPrompt", "aiCustomPromptDesc", {}));
  ai.appendChild(clearCacheRow());
  left.appendChild(ai);

  left.appendChild(sectionTitle(t("sectionAdvanced")));
  const adv = card();
  adv.appendChild(toggleRow("annotateCredits", t("credits"), t("creditsDesc")));
  adv.appendChild(toggleRow("debug", t("debug"), t("debugDesc"), () => {}));
  left.appendChild(adv);

  buildAboutCard(right);

  root.appendChild(left);
  root.appendChild(right);
}

function buildStatusBar(root: HTMLElement): HTMLElement {
  const bar = document.createElement("div");
  const s = nativeState();
  bar.className =
    "kc-status kc-full " +
    (s.state === "ready" ? "kc-ready" : s.state === "loading" ? "kc-loading" : "kc-bad");
  const label = document.createElement("span");
  const dot = document.createElement("span");
  dot.className = "kc-dot";
  label.appendChild(dot);
  const text =
    s.state === "ready"
      ? t("analyzerReady")
      : s.state === "loading"
        ? t("analyzerLoading")
        : s.state === "uninitialized"
          ? t("analyzerNotStarted")
          : `${t("analyzerFailed")}${s.error ? `: ${s.error}` : ""}`;
  label.appendChild(document.createTextNode(text));
  bar.appendChild(label);

  const rightSide = document.createElement("div");
  rightSide.className = "kc-status-right";
  rightSide.appendChild(buildLangToggle(root));
  const reannotate = document.createElement("button");
  reannotate.className = "kc-button";
  reannotate.textContent = t("reannotate");
  reannotate.onclick = () => {
    rescan();
    render(root);
  };
  rightSide.appendChild(reannotate);
  bar.appendChild(rightSide);
  return bar;
}

function buildLangToggle(root: HTMLElement): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "kc-lang";
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

  const repo = document.createElement("span");
  repo.className = "kc-link";
  repo.textContent = t("aboutRepo");
  repo.onclick = () => {
    try {
      betterncm.ncm.openUrl(REPO_URL);
    } catch {
      window.open(REPO_URL);
    }
  };
  box.appendChild(repo);

  const logPath = document.createElement("div");
  logPath.className = "kc-muted";
  logPath.textContent = `${t("aboutLog")}: C:\\betterncm\\kashiyomi.log`;
  box.appendChild(logPath);

  column.appendChild(box);
}
