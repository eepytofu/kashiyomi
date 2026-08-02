// The plugin manager settings panel. Plain DOM, no framework. Two columns:
// settings cards on the left, a live preview (rendered with the production
// line renderer) and an about card on the right.

import { resetAnalysisCache, rescan, resetTranslation } from "./annotator.ts";
import { panelLang, setPanelLang, t, tSongsCached, type PanelLang, type StringKey } from "./i18n.ts";
import { nativeState } from "./native.ts";
import { cachedTranslationCount, clearTranslationCache } from "./translator.ts";
import { applyStyles, renderJapaneseLine, renderPinyinRow } from "./render.ts";
import {
  DEFAULT_JP_FONT_STACK,
  DEFAULT_ZH_FONT_STACK,
  getSettings,
  updateSettings,
  type Settings,
} from "./settings.ts";

const REPO_URL = "https://github.com/eepytofu/kashiyomi";

type BooleanSettingKey = {
  [K in keyof Settings]-?: Settings[K] extends boolean ? K : never;
}[keyof Settings];

const PANEL_CSS = `
.kashiyomi-config { display: grid; grid-template-columns: minmax(340px, 1fr) minmax(250px, 0.75fr); gap: 14px; align-items: start; padding: 4px 2px 16px; max-width: 980px; }
.kashiyomi-config * { box-sizing: border-box; }
.kashiyomi-config .kc-full { grid-column: 1 / -1; }
.kashiyomi-config .kc-col { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.kashiyomi-config .kc-status {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 10px 14px; border-radius: 10px;
  background: rgba(255, 255, 255, 0.06); font-size: 13px;
}
.kashiyomi-config .kc-status-right { display: flex; align-items: center; gap: 8px; }
.kashiyomi-config .kc-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; background: #999; }
.kashiyomi-config .kc-ready .kc-dot { background: #52c41a; }
.kashiyomi-config .kc-bad .kc-dot { background: #ff4d4f; }
.kashiyomi-config .kc-loading .kc-dot { background: #faad14; }
.kashiyomi-config .kc-section-title { font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; opacity: 0.55; margin: 2px 2px -6px; }
.kashiyomi-config .kc-card { border-radius: 10px; background: rgba(255, 255, 255, 0.05); overflow: hidden; }
.kashiyomi-config .kc-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 11px 14px; cursor: pointer; }
.kashiyomi-config .kc-row + .kc-row { border-top: 1px solid rgba(255, 255, 255, 0.06); }
.kashiyomi-config .kc-row:hover { background: rgba(255, 255, 255, 0.04); }
.kashiyomi-config .kc-label { font-size: 13.5px; line-height: 1.3; }
.kashiyomi-config .kc-desc { font-size: 12px; opacity: 0.55; margin-top: 2px; line-height: 1.35; }
.kashiyomi-config .kc-switch { position: relative; flex: none; width: 36px; height: 20px; }
.kashiyomi-config .kc-switch input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
.kashiyomi-config .kc-track { position: absolute; inset: 0; border-radius: 999px; background: rgba(255, 255, 255, 0.22); transition: background 0.15s ease; }
.kashiyomi-config .kc-track::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform 0.15s ease; }
.kashiyomi-config .kc-switch input:checked + .kc-track { background: #ec4141; }
.kashiyomi-config .kc-switch input:checked + .kc-track::after { transform: translateX(16px); }
.kashiyomi-config .kc-button { padding: 6px 14px; border: none; border-radius: 8px; background: rgba(255, 255, 255, 0.1); color: inherit; font-size: 12.5px; cursor: pointer; }
.kashiyomi-config .kc-button:hover { background: rgba(255, 255, 255, 0.16); }
.kashiyomi-config .kc-select {
  position: relative; flex: none; display: inline-flex; align-items: center;
}
.kashiyomi-config .kc-select select {
  appearance: none; -webkit-appearance: none;
  padding: 7px 30px 7px 12px; border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px; background: rgba(255, 255, 255, 0.08); color: inherit;
  font-size: 12.5px; font-family: inherit; cursor: pointer; outline: none;
  min-width: 160px;
}
.kashiyomi-config .kc-select select:hover { background: rgba(255, 255, 255, 0.14); }
.kashiyomi-config .kc-select select:focus { border-color: rgba(236, 65, 65, 0.7); }
/* The native popup list is drawn by the OS, so its items only take solid
   colors; keep them readable instead of inheriting the panel's light text. */
.kashiyomi-config .kc-select option { background: #2b2b2b; color: #f2f2f2; }
.kashiyomi-config .kc-select::after {
  content: ""; position: absolute; right: 12px; pointer-events: none;
  width: 6px; height: 6px; border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor; transform: translateY(-2px) rotate(45deg);
  opacity: 0.6;
}
.kashiyomi-config .kc-input {
  padding: 7px 12px; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 8px;
  background: rgba(255, 255, 255, 0.08); color: inherit; font-size: 12.5px;
  font-family: inherit; outline: none;
}
.kashiyomi-config .kc-input:focus { border-color: rgba(236, 65, 65, 0.7); }
.kashiyomi-config input[type="range"] { accent-color: #ec4141; }
.kashiyomi-config .kc-lang { display: flex; border-radius: 8px; overflow: hidden; }
.kashiyomi-config .kc-lang button { padding: 6px 10px; border: none; background: rgba(255, 255, 255, 0.08); color: inherit; font-size: 12px; cursor: pointer; }
.kashiyomi-config .kc-lang button.kc-active { background: #ec4141; }
.kashiyomi-config .kc-preview { padding: 16px 14px 12px; display: flex; flex-direction: column; gap: 14px; }
.kashiyomi-config .kc-preview-line { font-size: 19px; line-height: 1.6; }
.kashiyomi-config .kc-preview-line .kashiyomi-row { opacity: 0.6; }
.kashiyomi-config .kc-about { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; font-size: 12.5px; }
.kashiyomi-config .kc-about .kc-muted { opacity: 0.55; word-break: break-all; }
.kashiyomi-config .kc-link { color: inherit; text-decoration: underline; cursor: pointer; opacity: 0.85; }
`;

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
  ai.appendChild(providerRow(root));
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

/** Builds the preview card into `column`; returns a refresh function. */
function buildPreviewCard(column: HTMLElement): () => void {
  column.appendChild(sectionTitle(t("preview")));
  const box = card();
  box.className += " kc-preview";
  column.appendChild(box);

  const refresh = () => {
    const settings = getSettings();
    applyStyles();
    box.textContent = "";

    // Sample annotations are canned so the preview never depends on the
    // native analyzer; classes match the real renderer so global styles
    // (furigana size, authored color) apply identically.
    const jpLine = document.createElement("div");
    jpLine.className = "kc-preview-line";
    renderJapaneseLine(
      jpLine,
      // 夢=0 見=1 て=2 る=3 ␣=4 何=5 も=6 見=7 て=8 な=9 い=10
      "夢見てる 何も見てない",
      {
        furigana: [
          { start: 0, end: 2, reading: "ゆめみ", origin: "inferred" },
          { start: 5, end: 6, reading: "なに", origin: "inferred" },
          { start: 7, end: 8, reading: "み", origin: "inferred" },
        ],
        romaji: "yume miteru nani mo mitenai",
        romajiSegments: [{ text: "yume miteru nani mo mitenai", origin: "inferred" }],
      },
      { furigana: settings.furigana, romaji: settings.romaji },
    );

    const hintLine = document.createElement("div");
    hintLine.className = "kc-preview-line";
    renderJapaneseLine(
      hintLine,
      "今宵も天は明るく",
      {
        furigana: [
          { start: 0, end: 2, reading: "こよい", origin: "inferred" },
          { start: 3, end: 4, reading: settings.readingHints ? "そら" : "てん", origin: settings.readingHints ? "authored" : "inferred" },
          { start: 5, end: 6, reading: "あか", origin: "inferred" },
        ],
        romaji: settings.readingHints ? "koyoi mo sora wa akaruku" : "koyoi mo ten wa akaruku",
        romajiSegments: settings.readingHints
          ? [
              { text: "koyoi mo", origin: "inferred" },
              { text: " sora", origin: "authored" },
              { text: " wa akaruku", origin: "inferred" },
            ]
          : [{ text: "koyoi mo ten wa akaruku", origin: "inferred" }],
      },
      { furigana: settings.furigana, romaji: settings.romaji },
    );

    if (settings.useJpFont && settings.jpFontStack.trim() !== "") {
      jpLine.style.fontFamily = settings.jpFontStack;
      hintLine.style.fontFamily = settings.jpFontStack;
    }
    box.appendChild(jpLine);
    box.appendChild(hintLine);

    const zhLine = document.createElement("div");
    zhLine.className = "kc-preview-line";
    zhLine.textContent = "我在每夜狂想";
    if (settings.useZhFont && settings.zhFontStack.trim() !== "") {
      zhLine.style.fontFamily = settings.zhFontStack;
    }
    if (settings.pinyin) {
      const syllables: [string, string][] = [
        ["wǒ", "wo"], ["zài", "zai"], ["měi", "mei"], ["yè", "ye"], ["kuáng", "kuang"], ["xiǎng", "xiang"],
      ];
      const groups = settings.pinyinJoinWords ? [[0], [1], [2, 3], [4, 5]] : [[0], [1], [2], [3], [4], [5]];
      const text = groups
        .map((group) => group.map((i) => syllables[i]![settings.pinyinTones ? 0 : 1]).join(""))
        .join(" ");
      renderPinyinRow(zhLine, text);
    }
    box.appendChild(zhLine);
  };
  refresh();
  return refresh;
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

function sectionTitle(text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "kc-section-title";
  el.textContent = text;
  return el;
}

function card(): HTMLElement {
  const el = document.createElement("div");
  el.className = "kc-card";
  return el;
}

function toggleRow(
  key: BooleanSettingKey,
  label: string,
  description: string,
  onExtra?: () => void,
  triggersRescan = true,
): HTMLElement {
  const row = document.createElement("label");
  row.className = "kc-row";
  const text = document.createElement("div");
  const labelEl = document.createElement("div");
  labelEl.className = "kc-label";
  labelEl.textContent = label;
  text.appendChild(labelEl);
  const desc = document.createElement("div");
  desc.className = "kc-desc";
  desc.textContent = description;
  text.appendChild(desc);
  row.appendChild(text);

  const toggle = document.createElement("span");
  toggle.className = "kc-switch";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = getSettings()[key];
  box.onchange = () => {
    updateSettings({ [key]: box.checked });
    // Reading-affecting settings invalidate cached analysis.
    if (key === "hanRepair" || key === "readingHints") resetAnalysisCache();
    applyStyles();
    if (triggersRescan) rescan();
    if (onExtra) onExtra();
  };
  const track = document.createElement("span");
  track.className = "kc-track";
  toggle.appendChild(box);
  toggle.appendChild(track);
  row.appendChild(toggle);
  return row;
}

function sizeRow(refreshPreview: () => void): HTMLElement {
  const row = document.createElement("div");
  row.className = "kc-row";
  const text = document.createElement("div");
  const label = document.createElement("div");
  label.className = "kc-label";
  label.textContent = t("furiganaSize");
  const desc = document.createElement("div");
  desc.className = "kc-desc";
  desc.textContent = t("furiganaSizeDesc");
  text.appendChild(label);
  text.appendChild(desc);
  row.appendChild(text);

  const control = document.createElement("div");
  control.style.cssText = "display:flex;align-items:center;gap:10px;flex:none;";
  const value = document.createElement("span");
  value.style.cssText = "font-size:12px;opacity:0.7;min-width:38px;text-align:right;";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "10";
  slider.max = "100";
  slider.step = "5";
  slider.value = String(getSettings().furiganaSize);
  value.textContent = `${slider.value}%`;
  slider.oninput = () => {
    value.textContent = `${slider.value}%`;
    updateSettings({ furiganaSize: Number(slider.value) });
    applyStyles();
    refreshPreview();
  };
  control.appendChild(slider);
  control.appendChild(value);
  row.appendChild(control);
  return row;
}

type StringSettingKey = {
  [K in keyof Settings]-?: Settings[K] extends string ? K : never;
}[keyof Settings];

function fontStackRow(
  key: "jpFontStack" | "zhFontStack",
  defaultValue: string,
  labelKey: StringKey,
  descKey: StringKey,
  refreshPreview: () => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "kc-row";
  row.style.flexWrap = "wrap";
  row.appendChild(rowText(t(labelKey), t(descKey)));

  const control = document.createElement("div");
  control.style.cssText = "display:flex;align-items:center;gap:8px;flex:1 1 100%;";
  const input = textInput(getSettings()[key]);
  input.onchange = () => {
    updateSettings({ [key]: input.value });
    applyStyles();
    refreshPreview();
  };
  const reset = document.createElement("button");
  reset.className = "kc-button";
  reset.textContent = t("reset");
  reset.onclick = () => {
    input.value = defaultValue;
    updateSettings({ [key]: defaultValue });
    applyStyles();
    refreshPreview();
  };
  control.appendChild(input);
  control.appendChild(reset);
  row.appendChild(control);
  return row;
}

function textRow(
  key: StringSettingKey,
  labelKey: StringKey,
  descKey: StringKey,
  options: { placeholder?: string; password?: boolean },
): HTMLElement {
  const row = document.createElement("div");
  row.className = "kc-row";
  row.style.flexWrap = "wrap";
  row.appendChild(rowText(t(labelKey), t(descKey)));
  const input = textInput(getSettings()[key]);
  input.style.flex = "1 1 100%";
  if (options.placeholder) input.placeholder = options.placeholder;
  if (options.password) input.type = "password";
  input.onchange = () => {
    updateSettings({ [key]: input.value });
    resetTranslation();
  };
  row.appendChild(input);
  return row;
}

function providerRow(root: HTMLElement): HTMLElement {
  const row = document.createElement("div");
  row.className = "kc-row";
  row.appendChild(rowText(t("aiProvider"), t("aiProviderDesc")));
  const { wrap, select } = styledSelect();
  for (const [value, label] of [
    ["openai", "OpenAI-compatible"],
    ["gemini", "Gemini"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    if (getSettings().aiProvider === value) option.selected = true;
    select.appendChild(option);
  }
  select.onchange = () => {
    updateSettings({ aiProvider: select.value as Settings["aiProvider"] });
    resetTranslation();
    // Provider choice changes which rows exist (base URL, placeholders).
    render(root);
  };
  row.appendChild(wrap);
  return row;
}

const COMMON_TARGET_LANGS = [
  "English",
  "简体中文",
  "繁體中文",
  "Bahasa Indonesia",
  "日本語",
  "한국어",
  "Español",
  "Français",
  "Deutsch",
  "Português",
  "Русский",
  "ไทย",
  "Tiếng Việt",
  "العربية",
];

function targetLangRow(): HTMLElement {
  const row = document.createElement("div");
  row.className = "kc-row";
  row.style.flexWrap = "wrap";
  row.appendChild(rowText(t("aiTargetLang"), t("aiTargetLangDesc")));

  const CUSTOM = "__custom__";
  const current = getSettings().aiTargetLang;
  const isListed = COMMON_TARGET_LANGS.includes(current);

  const { wrap, select } = styledSelect();
  for (const lang of COMMON_TARGET_LANGS) {
    const option = document.createElement("option");
    option.value = lang;
    option.textContent = lang;
    if (lang === current) option.selected = true;
    select.appendChild(option);
  }
  const customOption = document.createElement("option");
  customOption.value = CUSTOM;
  customOption.textContent = t("customOption");
  if (!isListed) customOption.selected = true;
  select.appendChild(customOption);

  const input = textInput(isListed ? "" : current);
  input.style.flex = "1 1 100%";
  input.style.display = isListed ? "none" : "";
  input.placeholder = "Sundanese / Jawa / ...";
  input.onchange = () => {
    if (input.value.trim() !== "") {
      updateSettings({ aiTargetLang: input.value.trim() });
      resetTranslation();
    }
  };

  select.onchange = () => {
    if (select.value === CUSTOM) {
      input.style.display = "";
      input.focus();
    } else {
      input.style.display = "none";
      updateSettings({ aiTargetLang: select.value });
      resetTranslation();
    }
  };

  row.appendChild(wrap);
  row.appendChild(input);
  return row;
}

function apiKeysRow(): HTMLElement {
  const row = document.createElement("div");
  row.className = "kc-row";
  row.style.flexWrap = "wrap";
  row.appendChild(rowText(t("aiApiKey"), t("aiApiKeyDesc")));

  const area = document.createElement("textarea");
  area.className = "kc-input";
  area.rows = 2;
  area.spellcheck = false;
  area.style.cssText += "flex:1 1 100%;resize:vertical;min-height:52px;";
  area.value = getSettings().aiApiKey;
  area.placeholder = "sk-...";
  // Keys are secrets: show them masked until the field is focused.
  // -webkit-text-security is not in the CSSStyleDeclaration typings but is
  // supported by the CEF build NCM ships.
  const setMasked = (masked: boolean) => {
    area.style.setProperty("-webkit-text-security", masked ? "disc" : "none");
  };
  setMasked(true);
  area.onfocus = () => setMasked(false);
  area.onblur = () => {
    updateSettings({ aiApiKey: area.value });
    resetTranslation();
    setMasked(true);
  };
  row.appendChild(area);
  return row;
}

function clearCacheRow(): HTMLElement {
  const row = document.createElement("div");
  row.className = "kc-row";
  const count = cachedTranslationCount();
  const text = rowText(
    t("aiClearCache"),
    `${t("aiClearCacheDesc")} (${tSongsCached(count)})`,
  );
  row.appendChild(text);

  const button = document.createElement("button");
  button.className = "kc-button";
  button.textContent = t("clear");
  button.disabled = count === 0;
  button.style.opacity = count === 0 ? "0.5" : "";
  button.onclick = () => {
    clearTranslationCache();
    resetTranslation();
    button.textContent = t("cleared");
    button.disabled = true;
    button.style.opacity = "0.5";
    const desc = text.querySelector(".kc-desc");
    if (desc) desc.textContent = `${t("aiClearCacheDesc")} (${tSongsCached(0)})`;
  };
  row.appendChild(button);
  return row;
}

function rowText(label: string, description: string): HTMLElement {
  const text = document.createElement("div");
  const labelEl = document.createElement("div");
  labelEl.className = "kc-label";
  labelEl.textContent = label;
  text.appendChild(labelEl);
  const desc = document.createElement("div");
  desc.className = "kc-desc";
  desc.textContent = description;
  text.appendChild(desc);
  return text;
}

function textInput(value: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.className = "kc-input";
  input.style.flex = "1";
  return input;
}

/** Wraps a select so the custom chevron and popup colors apply. */
function styledSelect(): { wrap: HTMLElement; select: HTMLSelectElement } {
  const wrap = document.createElement("span");
  wrap.className = "kc-select";
  const select = document.createElement("select");
  wrap.appendChild(select);
  return { wrap, select };
}
