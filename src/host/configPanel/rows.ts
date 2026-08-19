// The panel's building blocks: cards, rows, and the four row shapes every
// setting is rendered with. Nothing here knows which settings exist.

import { rescan } from "../annotator.ts";
import { resetAnalysisCache } from "../analysisCache.ts";
import { resetTranslation } from "../translationLane.ts";
import { t, type StringKey } from "../i18n.ts";
import { applyStyles } from "../styles.ts";
import { connectControl, uiButton } from "../uiPrimitives.ts";
import {
  getSettings,
  MAX_FURIGANA_SIZE,
  MIN_FURIGANA_SIZE,
  updateSettings,
  type Settings,
} from "../settings.ts";
import { onPanelTeardown } from "./lifecycle.ts";

export type BooleanSettingKey = {
  [K in keyof Settings]-?: Settings[K] extends boolean ? K : never;
}[keyof Settings];

export type StringSettingKey = {
  [K in keyof Settings]-?: Settings[K] extends string ? K : never;
}[keyof Settings];

export function sectionTitle(text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "kc-section-title";
  el.textContent = text;
  return el;
}

export function card(): HTMLElement {
  const el = document.createElement("div");
  el.className = "kc-card";
  return el;
}

export function row(tag: "div" | "label" = "div"): HTMLElement {
  const el = document.createElement(tag);
  el.className = "kc-row";
  return el;
}

/** The label-and-description block every row leads with. */
export function rowText(label: string, description: string): HTMLElement {
  const text = document.createElement("div");
  const labelEl = document.createElement("div");
  labelEl.className = "kc-label";
  labelEl.textContent = label;
  text.appendChild(labelEl);
  // A description that only restates its label is noise, and it also makes the
  if (description !== "") {
    const desc = document.createElement("div");
    desc.className = "kc-desc";
    desc.textContent = description;
    text.appendChild(desc);
  }
  return text;
}

export function textInput(value: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.className = "kc-input";
  input.style.flex = "1";
  return input;
}

export function toggleRow(
  key: BooleanSettingKey,
  label: string,
  description: string,
  onExtra?: () => void,
  triggersRescan = true,
): HTMLElement {
  const el = row("label");
  const text = rowText(label, description);
  el.appendChild(text);

  const toggle = document.createElement("span");
  toggle.className = "kc-switch";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = getSettings()[key];
  connectControl(text, box);
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
  el.appendChild(toggle);
  return el;
}

export function sizeRow(refreshPreview: () => void): HTMLElement {
  const el = row();
  const text = rowText(t("furiganaSize"), t("furiganaSizeDesc"));
  el.appendChild(text);

  const control = document.createElement("div");
  control.style.cssText = "display:flex;align-items:center;gap:10px;flex:none;";
  const value = document.createElement("span");
  value.style.cssText = "font-size:12px;opacity:0.7;min-width:38px;text-align:right;";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = String(MIN_FURIGANA_SIZE);
  slider.max = String(MAX_FURIGANA_SIZE);
  slider.step = "5";
  connectControl(text, slider);
  // A stored value below the floor would otherwise leave the readout showing a
  // size the stylesheet has already clamped away.
  slider.value = String(Math.max(MIN_FURIGANA_SIZE, getSettings().furiganaSize));
  value.textContent = `${slider.value}%`;
  slider.oninput = () => {
    value.textContent = `${slider.value}%`;
    updateSettings({ furiganaSize: Number(slider.value) });
    applyStyles();
    refreshPreview();
  };
  control.appendChild(slider);
  control.appendChild(value);
  el.appendChild(control);
  return el;
}

export function fontStackRow(
  key: "jpFontStack" | "zhFontStack" | "rowFontStack",
  defaultValue: string,
  labelKey: StringKey,
  descKey: StringKey,
  refreshPreview: () => void,
): HTMLElement {
  const el = row();
  el.style.flexWrap = "wrap";
  const text = rowText(t(labelKey), t(descKey));
  el.appendChild(text);

  const control = document.createElement("div");
  control.style.cssText = "display:flex;align-items:center;gap:8px;flex:1 1 100%;";
  const input = textInput(getSettings()[key]);
  connectControl(text, input);
  let saved = input.value;
  const commit = () => {
    if (input.value === saved) return;
    saved = input.value;
    updateSettings({ [key]: input.value });
    applyStyles();
    refreshPreview();
  };
  input.onchange = commit;
  input.onblur = commit;
  onPanelTeardown(commit);
  const reset = uiButton(t("reset"));
  reset.onclick = () => {
    input.value = defaultValue;
    commit();
  };
  control.appendChild(input);
  control.appendChild(reset);
  el.appendChild(control);
  return el;
}

export function textRow(
  key: StringSettingKey,
  labelKey: StringKey,
  descKey: StringKey,
  options: { placeholder?: string; password?: boolean },
): HTMLElement {
  const el = row();
  el.style.flexWrap = "wrap";
  const text = rowText(t(labelKey), t(descKey));
  el.appendChild(text);
  const input = textInput(getSettings()[key]);
  connectControl(text, input);
  input.style.flex = "1 1 100%";
  if (options.placeholder) input.placeholder = options.placeholder;
  if (options.password) input.type = "password";
  let saved = input.value;
  const commit = () => {
    if (input.value === saved) return;
    saved = input.value;
    updateSettings({ [key]: input.value });
    resetTranslation();
  };
  input.onchange = commit;
  input.onblur = commit;
  onPanelTeardown(commit);
  el.appendChild(input);
  return el;
}

/** The user's own word→reading list, as free text. */
export function readingOverridesRow(): HTMLElement {
  const el = row();
  el.style.flexWrap = "wrap";
  const text = rowText(t("readingOverrides"), t("readingOverridesDesc"));
  el.appendChild(text);

  const area = document.createElement("textarea");
  area.className = "kc-input";
  area.rows = 3;
  area.spellcheck = false;
  area.style.cssText += "flex:1 1 100%;resize:vertical;min-height:64px;";
  area.value = getSettings().readingOverrides;
  area.placeholder = "春風=はるかぜ";
  connectControl(text, area);
  let saved = area.value;
  const commit = () => {
    if (area.value === saved) return;
    saved = area.value;
    updateSettings({ readingOverrides: area.value });
    resetAnalysisCache();
    rescan();
  };
  area.onchange = commit;
  area.onblur = commit;
  onPanelTeardown(commit);
  el.appendChild(area);
  return el;
}
