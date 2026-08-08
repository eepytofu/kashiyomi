// Rows specific to the AI translation lane. Kept apart from rows.ts because

import { t, tSongsCached } from "../i18n.ts";
import { getSettings, updateSettings, type Settings } from "../settings.ts";
import { resetTranslation } from "../translationLane.ts";
import { cachedTranslationCount, clearTranslationCache } from "../translator.ts";
import { dropdown } from "./dropdown.ts";
import { row, rowText, textInput } from "./rows.ts";

/**
 * `onProvider` updates the rows the choice affects: the base URL and the model
 */
export function providerRow(onProvider: (provider: Settings["aiProvider"]) => void): HTMLElement {
  const el = row();
  el.appendChild(rowText(t("aiProvider"), t("aiProviderDesc")));
  const control = dropdown({
    options: [
      { value: "openai", label: "OpenAI-compatible" },
      { value: "gemini", label: "Gemini" },
    ],
    value: getSettings().aiProvider,
    label: t("aiProvider"),
    onChange: (value) => {
      const provider = value as Settings["aiProvider"];
      updateSettings({ aiProvider: provider });
      resetTranslation();
      onProvider(provider);
    },
  });
  el.appendChild(control.el);
  return el;
}

/**
 * The shortcut list, not a catalogue. Custom takes anything not here, so the
 * only job of this list is to save typing for the languages people actually
 * pick.
 */
const COMMON_TARGET_LANGS: readonly { label: string; search: string }[] = [
  { label: "English", search: "english" },
  { label: "简体中文", search: "chinese simplified" },
  { label: "繁體中文", search: "chinese traditional" },
  { label: "日本語", search: "japanese" },
  { label: "한국어", search: "korean" },
  { label: "Bahasa Indonesia", search: "indonesian" },
  { label: "Bahasa Melayu", search: "malay" },
  { label: "Basa Jawa", search: "javanese" },
  { label: "Basa Sunda", search: "sundanese" },
  { label: "Tiếng Việt", search: "vietnamese" },
  { label: "ไทย", search: "thai" },
  { label: "Filipino", search: "filipino tagalog" },
  { label: "ភាសាខ្មែរ", search: "khmer" },
  { label: "မြန်မာ", search: "burmese myanmar" },
  { label: "Español", search: "spanish" },
  { label: "Português", search: "portuguese" },
  { label: "Français", search: "french" },
  { label: "Deutsch", search: "german" },
  { label: "Italiano", search: "italian" },
  { label: "Nederlands", search: "dutch" },
  { label: "Polski", search: "polish" },
  { label: "Čeština", search: "czech" },
  { label: "Română", search: "romanian" },
  { label: "Magyar", search: "hungarian" },
  { label: "Svenska", search: "swedish" },
  { label: "Norsk", search: "norwegian" },
  { label: "Dansk", search: "danish" },
  { label: "Suomi", search: "finnish" },
  { label: "Türkçe", search: "turkish" },
  { label: "Ελληνικά", search: "greek" },
  { label: "Русский", search: "russian" },
  { label: "Українська", search: "ukrainian" },
  { label: "עברית", search: "hebrew" },
  { label: "العربية", search: "arabic" },
  { label: "فارسی", search: "persian farsi" },
  { label: "اردو", search: "urdu" },
  { label: "हिन्दी", search: "hindi" },
  { label: "বাংলা", search: "bengali" },
  { label: "தமிழ்", search: "tamil" },
  { label: "Kiswahili", search: "swahili" },
];

export function targetLangRow(): HTMLElement {
  const el = row();
  el.style.flexWrap = "wrap";
  el.appendChild(rowText(t("aiTargetLang"), t("aiTargetLangDesc")));

  const CUSTOM = "__custom__";
  const current = getSettings().aiTargetLang;
  const isListed = COMMON_TARGET_LANGS.some((lang) => lang.label === current);

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

  const control = dropdown({
    options: [
      ...COMMON_TARGET_LANGS.map((lang) => ({ value: lang.label, label: lang.label, search: lang.search })),
      { value: CUSTOM, label: t("customOption") },
    ],
    value: isListed ? current : CUSTOM,
    label: t("aiTargetLang"),
    onChange: (value) => {
      if (value === CUSTOM) {
        input.style.display = "";
        input.focus();
        return;
      }
      input.style.display = "none";
      updateSettings({ aiTargetLang: value });
      resetTranslation();
    },
  });

  el.appendChild(control.el);
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

/**
 * The count is the point of this row, so it renders with or without a
 * description. Emptying `aiClearCacheDesc` left the interpolation producing a
 * leading space before "(3 songs stored)".
 */
function cacheDesc(count: number): string {
  const desc = t("aiClearCacheDesc");
  const stored = `(${tSongsCached(count)})`;
  return desc === "" ? stored : `${desc} ${stored}`;
}

export function clearCacheRow(): HTMLElement {
  const el = row();
  const count = cachedTranslationCount();
  const text = rowText(t("aiClearCache"), cacheDesc(count));
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
    if (desc) desc.textContent = cacheDesc(0);
  };
  el.appendChild(button);
  return el;
}
