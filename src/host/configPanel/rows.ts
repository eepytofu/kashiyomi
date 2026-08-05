// The panel's building blocks: cards, rows, and the four row shapes every
// setting is rendered with. Nothing here knows which settings exist.

import { rescan } from "../annotator.ts";
import { resetAnalysisCache } from "../analysisCache.ts";
import { resetTranslation } from "../translationLane.ts";
import { t, type StringKey } from "../i18n.ts";
import { applyStyles } from "../styles.ts";
import {
  getSettings,
  MAX_FURIGANA_SIZE,
  MIN_FURIGANA_SIZE,
  updateSettings,
  type Settings,
} from "../settings.ts";

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

/**
 * One row of a card. Toggles use a `<label>` so clicking the text flips the
 * switch; every other row is an ordinary div.
 */
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
  // row taller than its neighbours for nothing. Those are blanked per language
  // in i18n.ts rather than deleted, so a translation can keep one where the
  // label alone does not carry.
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

/** Wraps a select so the custom chevron and popup colors apply. */
export function styledSelect(): { wrap: HTMLElement; select: HTMLSelectElement } {
  const wrap = document.createElement("span");
  wrap.className = "kc-select";
  const select = document.createElement("select");
  wrap.appendChild(select);
  return { wrap, select };
}

export function toggleRow(
  key: BooleanSettingKey,
  label: string,
  description: string,
  onExtra?: () => void,
  triggersRescan = true,
): HTMLElement {
  const el = row("label");
  el.appendChild(rowText(label, description));

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
  el.appendChild(toggle);
  return el;
}

export function sizeRow(refreshPreview: () => void): HTMLElement {
  const el = row();
  el.appendChild(rowText(t("furiganaSize"), t("furiganaSizeDesc")));

  const control = document.createElement("div");
  control.style.cssText = "display:flex;align-items:center;gap:10px;flex:none;";
  const value = document.createElement("span");
  value.style.cssText = "font-size:12px;opacity:0.7;min-width:38px;text-align:right;";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = String(MIN_FURIGANA_SIZE);
  slider.max = String(MAX_FURIGANA_SIZE);
  slider.step = "5";
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
  el.appendChild(rowText(t(labelKey), t(descKey)));

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
  el.appendChild(rowText(t(labelKey), t(descKey)));
  const input = textInput(getSettings()[key]);
  input.style.flex = "1 1 100%";
  if (options.placeholder) input.placeholder = options.placeholder;
  if (options.password) input.type = "password";
  input.onchange = () => {
    updateSettings({ [key]: input.value });
    resetTranslation();
  };
  el.appendChild(input);
  return el;
}
