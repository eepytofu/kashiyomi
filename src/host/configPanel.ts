// The plugin manager settings panel. Plain DOM with card-style sections and
// switch toggles; no framework.

import { rescan } from "./annotator.ts";
import { nativeState } from "./native.ts";
import { applyStyles } from "./render.ts";
import { DEFAULT_JP_FONT_STACK, getSettings, updateSettings, type Settings } from "./settings.ts";

type BooleanSettingKey = {
  [K in keyof Settings]: Settings[K] extends boolean ? K : never;
}[keyof Settings];

type ToggleSpec = {
  key: BooleanSettingKey;
  label: string;
  description?: string;
};

type SectionSpec = {
  title: string;
  toggles: ToggleSpec[];
};

const SECTIONS: SectionSpec[] = [
  {
    title: "Japanese",
    toggles: [
      { key: "furigana", label: "Furigana", description: "Readings above kanji" },
      { key: "romaji", label: "Romaji line", description: "A small romaji line under the lyric" },
      {
        key: "readingHints",
        label: "Reading hints",
        description: "Use readings the lyric itself provides, like 天(そら); shown in a different color",
      },
      {
        key: "hanRepair",
        label: "Kanji repair",
        description: "Fix Chinese glyph forms in Japanese lyrics, like 梦见ては to 夢見ては",
      },
    ],
  },
  {
    title: "Chinese",
    toggles: [
      { key: "pinyin", label: "Pinyin line", description: "A small pinyin line under the lyric" },
      { key: "pinyinTones", label: "Tone marks", description: "shī háng instead of shi hang" },
      {
        key: "pinyinJoinWords",
        label: "Group Pinyin by word",
        description: "Syllables of one detected word stay together",
      },
    ],
  },
  {
    title: "Advanced",
    toggles: [
      { key: "debug", label: "Debug logging", description: "Verbose logs in the console and kashiyomi.log" },
    ],
  },
];

const PANEL_CSS = `
.kashiyomi-config { display: flex; flex-direction: column; gap: 14px; padding: 4px 2px 16px; max-width: 640px; }
.kashiyomi-config * { box-sizing: border-box; }
.kashiyomi-config .kc-status {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 10px 14px; border-radius: 10px;
  background: rgba(255, 255, 255, 0.06); font-size: 13px;
}
.kashiyomi-config .kc-status .kc-dot {
  display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px;
  background: #999;
}
.kashiyomi-config .kc-status.kc-ready .kc-dot { background: #52c41a; }
.kashiyomi-config .kc-status.kc-bad .kc-dot { background: #ff4d4f; }
.kashiyomi-config .kc-status.kc-loading .kc-dot { background: #faad14; }
.kashiyomi-config .kc-section-title {
  font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
  opacity: 0.55; margin: 2px 2px -6px;
}
.kashiyomi-config .kc-card {
  border-radius: 10px; background: rgba(255, 255, 255, 0.05); overflow: hidden;
}
.kashiyomi-config .kc-row {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 11px 14px; cursor: pointer;
}
.kashiyomi-config .kc-row + .kc-row { border-top: 1px solid rgba(255, 255, 255, 0.06); }
.kashiyomi-config .kc-row:hover { background: rgba(255, 255, 255, 0.04); }
.kashiyomi-config .kc-label { font-size: 13.5px; line-height: 1.3; }
.kashiyomi-config .kc-desc { font-size: 12px; opacity: 0.55; margin-top: 2px; line-height: 1.35; }
.kashiyomi-config .kc-switch { position: relative; flex: none; width: 36px; height: 20px; }
.kashiyomi-config .kc-switch input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
.kashiyomi-config .kc-switch .kc-track {
  position: absolute; inset: 0; border-radius: 999px;
  background: rgba(255, 255, 255, 0.22); transition: background 0.15s ease;
}
.kashiyomi-config .kc-switch .kc-track::after {
  content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
  border-radius: 50%; background: #fff; transition: transform 0.15s ease;
}
.kashiyomi-config .kc-switch input:checked + .kc-track { background: #ec4141; }
.kashiyomi-config .kc-switch input:checked + .kc-track::after { transform: translateX(16px); }
.kashiyomi-config .kc-button {
  align-self: flex-start; padding: 7px 16px; border: none; border-radius: 8px;
  background: rgba(255, 255, 255, 0.1); color: inherit; font-size: 13px; cursor: pointer;
}
.kashiyomi-config .kc-button:hover { background: rgba(255, 255, 255, 0.16); }
`;

export function buildConfigPanel(): HTMLElement {
  const root = document.createElement("div");
  root.className = "kashiyomi-config";
  const style = document.createElement("style");
  style.textContent = PANEL_CSS;
  root.appendChild(style);

  const status = document.createElement("div");
  status.className = "kc-status";
  const statusText = document.createElement("span");
  const refreshButton = document.createElement("button");
  refreshButton.className = "kc-button";
  refreshButton.textContent = "Re-annotate";
  const refreshStatus = () => {
    const s = nativeState();
    status.className = "kc-status " + (s.state === "ready" ? "kc-ready" : s.state === "loading" ? "kc-loading" : "kc-bad");
    statusText.innerHTML = "";
    const dot = document.createElement("span");
    dot.className = "kc-dot";
    statusText.appendChild(dot);
    const label =
      s.state === "ready"
        ? "Analyzer ready"
        : s.state === "loading"
          ? "Dictionary loading"
          : s.state === "uninitialized"
            ? "Analyzer not started"
            : `Analyzer ${s.state}${s.error ? `: ${s.error}` : ""}`;
    statusText.appendChild(document.createTextNode(label));
  };
  refreshButton.onclick = () => {
    refreshStatus();
    rescan();
  };
  refreshStatus();
  status.appendChild(statusText);
  status.appendChild(refreshButton);
  root.appendChild(status);

  for (const section of SECTIONS) {
    const title = document.createElement("div");
    title.className = "kc-section-title";
    title.textContent = section.title;
    root.appendChild(title);

    const card = document.createElement("div");
    card.className = "kc-card";
    for (const spec of section.toggles) {
      card.appendChild(buildToggleRow(spec));
    }
    if (section.title === "Japanese") {
      card.appendChild(buildFuriganaSizeRow());
      card.appendChild(buildToggleRow({
        key: "useJpFont",
        label: "Japanese font on Japanese lyrics",
        description: "The same Han character can render with a Chinese glyph; force a Japanese font stack",
      }, applyStyles));
      card.appendChild(buildFontStackRow());
    }
    root.appendChild(card);
  }

  return root;
}

function buildFuriganaSizeRow(): HTMLElement {
  const row = document.createElement("div");
  row.className = "kc-row";
  const text = document.createElement("div");
  const label = document.createElement("div");
  label.className = "kc-label";
  label.textContent = "Furigana size";
  const desc = document.createElement("div");
  desc.className = "kc-desc";
  desc.textContent = "Reading size relative to the lyric text";
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
  };
  control.appendChild(slider);
  control.appendChild(value);
  row.appendChild(control);
  return row;
}

function buildFontStackRow(): HTMLElement {
  const row = document.createElement("div");
  row.className = "kc-row";
  row.style.flexWrap = "wrap";
  const text = document.createElement("div");
  const label = document.createElement("div");
  label.className = "kc-label";
  label.textContent = "Japanese font stack";
  const desc = document.createElement("div");
  desc.className = "kc-desc";
  desc.textContent = "Installed fonts, first choice to fallback";
  text.appendChild(label);
  text.appendChild(desc);
  row.appendChild(text);

  const control = document.createElement("div");
  control.style.cssText = "display:flex;align-items:center;gap:8px;flex:1 1 100%;";
  const input = document.createElement("input");
  input.type = "text";
  input.value = getSettings().jpFontStack;
  input.style.cssText =
    "flex:1;padding:6px 10px;border:none;border-radius:6px;background:rgba(255,255,255,0.1);color:inherit;font-size:12.5px;";
  input.onchange = () => {
    updateSettings({ jpFontStack: input.value });
    applyStyles();
  };
  const reset = document.createElement("button");
  reset.className = "kc-button";
  reset.textContent = "Reset";
  reset.onclick = () => {
    input.value = DEFAULT_JP_FONT_STACK;
    updateSettings({ jpFontStack: DEFAULT_JP_FONT_STACK });
    applyStyles();
  };
  control.appendChild(input);
  control.appendChild(reset);
  row.appendChild(control);
  return row;
}

function buildToggleRow(spec: ToggleSpec, onChange?: () => void): HTMLElement {
  const row = document.createElement("label");
  row.className = "kc-row";

  const text = document.createElement("div");
  const label = document.createElement("div");
  label.className = "kc-label";
  label.textContent = spec.label;
  text.appendChild(label);
  if (spec.description) {
    const desc = document.createElement("div");
    desc.className = "kc-desc";
    desc.textContent = spec.description;
    text.appendChild(desc);
  }
  row.appendChild(text);

  const toggle = document.createElement("span");
  toggle.className = "kc-switch";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = getSettings()[spec.key];
  box.onchange = () => {
    updateSettings({ [spec.key]: box.checked });
    if (onChange) onChange();
    else rescan();
  };
  const track = document.createElement("span");
  track.className = "kc-track";
  toggle.appendChild(box);
  toggle.appendChild(track);
  row.appendChild(toggle);
  return row;
}
