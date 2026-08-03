// Rows specific to the AI translation lane. Kept apart from rows.ts because
// each of these carries knowledge the generic primitives do not: the provider
// list, the target-language list, that keys are secrets, and that the cache
// count has to be re-read after clearing.

import { t, tSongsCached } from "../i18n.ts";
import { getSettings, updateSettings, type Settings } from "../settings.ts";
import { resetTranslation } from "../translationLane.ts";
import { cachedTranslationCount, clearTranslationCache } from "../translator.ts";
import { row, rowText, styledSelect, textInput } from "./rows.ts";

/** `rerender` rebuilds the whole panel: the provider decides which rows exist. */
export function providerRow(rerender: () => void): HTMLElement {
  const el = row();
  el.appendChild(rowText(t("aiProvider"), t("aiProviderDesc")));
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
    rerender();
  };
  el.appendChild(wrap);
  return el;
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

export function targetLangRow(): HTMLElement {
  const el = row();
  el.style.flexWrap = "wrap";
  el.appendChild(rowText(t("aiTargetLang"), t("aiTargetLangDesc")));

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

  el.appendChild(wrap);
  el.appendChild(input);
  return el;
}

export function apiKeysRow(): HTMLElement {
  const el = row();
  el.style.flexWrap = "wrap";
  el.appendChild(rowText(t("aiApiKey"), t("aiApiKeyDesc")));

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
  el.appendChild(area);
  return el;
}

export function clearCacheRow(): HTMLElement {
  const el = row();
  const count = cachedTranslationCount();
  const text = rowText(t("aiClearCache"), `${t("aiClearCacheDesc")} (${tSongsCached(count)})`);
  el.appendChild(text);

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
  el.appendChild(button);
  return el;
}
