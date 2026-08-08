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

export function toggleRow(
  key: BooleanSettingKey,
  label: string,
  description: string,
  onExtra?: () => void,
  triggersRescan = true,
): HTMLElement {
  const el = row();
  el.appendChild(rowText(label, description));

  // The label wraps the switch alone, not the row. Every other row's control is
  // the only hit target, and a row that highlights but does nothing is worse
  // than one that never offered.
  const toggle = document.createElement("label");
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

/**
 * The user's own word→reading list, as free text.
 *
 * A textarea rather than a managed list of rows: the list is expected to be
 * short and rarely touched, and `word=reading` per line is something you can
 * paste, diff and back up. A row-per-entry widget would be more code and less
 * portable for the same result.
 *
 * Written on blur, then the analysis cache is dropped and every visible line is
 * analyzed again. **Both steps are required.** `rescan()` only clears the DOM;
 * the annotation cache is keyed by display text, so a rescan without
 * `resetAnalysisCache()` re-renders the reading the user just changed and the
 * setting looks like it does nothing. Same pairing `hanRepair` and
 * `readingHints` need, for the same reason.
 */
export function readingOverridesRow(): HTMLElement {
  const el = row();
  el.style.flexWrap = "wrap";
  el.appendChild(rowText(t("readingOverrides"), t("readingOverridesDesc")));

  const area = document.createElement("textarea");
  area.className = "kc-input";
  area.rows = 3;
  area.spellcheck = false;
  area.style.cssText += "flex:1 1 100%;resize:vertical;min-height:64px;";
  area.value = getSettings().readingOverrides;
  area.placeholder = "春風=はるかぜ";
  area.onblur = () => {
    if (area.value === getSettings().readingOverrides) return;
    updateSettings({ readingOverrides: area.value });
    resetAnalysisCache();
    rescan();
  };
  el.appendChild(area);
  return el;
}
