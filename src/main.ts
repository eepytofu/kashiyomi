// Kashiyomi entry point. BetterNCM injects the bundled dist/main.js into the
// main NCM page.

import { rescan, startAnnotator } from "./host/annotator.ts";
import { log } from "./host/log.ts";
import { nativeInit, nativeState } from "./host/native.ts";
import { resolveAssetPaths } from "./host/paths.ts";
import { injectStyles } from "./host/render.ts";
import { getSettings, updateSettings, type Settings } from "./host/settings.ts";

async function start(): Promise<void> {
  injectStyles();
  const paths = await resolveAssetPaths();
  if (!paths) {
    log.warn("asset paths unresolved; Japanese analysis disabled");
    return;
  }
  log.info("asset paths", paths);
  const status = nativeState();
  log.info("native state:", status.state, status.error ?? "");
  if (status.state === "uninitialized" || status.state === "failed") {
    nativeInit(paths.dictPath, paths.resourceDir);
  }
  startAnnotator(paths);

  // Debug handle for testing from the console.
  (window as unknown as Record<string, unknown>).kashiyomi = {
    state: () => nativeState(),
    rescan,
    settings: getSettings,
  };
}

plugin.onLoad(() => {
  log.info("loaded");
  void start();
});

plugin.onConfig(() => {
  const root = document.createElement("div");
  root.style.cssText = "display:flex;flex-direction:column;gap:8px;padding:8px;font-size:14px;";

  const status = document.createElement("div");
  const refreshStatus = () => {
    const s = nativeState();
    status.textContent = `Analyzer: ${s.state}${s.error ? ` (${s.error})` : ""}`;
  };
  refreshStatus();
  root.appendChild(status);

  const toggles: [keyof Settings, string][] = [
    ["furigana", "Furigana"],
    ["romaji", "Romaji line"],
    ["pinyin", "Pinyin line"],
    ["pinyinTones", "Pinyin tone marks"],
    ["pinyinJoinWords", "Group Pinyin by word"],
    ["hanRepair", "Kanji repair"],
    ["readingHints", "Reading hints like 天(そら)"],
    ["debug", "Debug logging"],
  ];
  for (const [key, label] of toggles) {
    const row = document.createElement("label");
    row.style.cssText = "display:flex;align-items:center;gap:6px;cursor:pointer;";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = getSettings()[key];
    box.onchange = () => {
      updateSettings({ [key]: box.checked });
      rescan();
    };
    row.appendChild(box);
    row.appendChild(document.createTextNode(label));
    root.appendChild(row);
  }

  const rescanButton = document.createElement("button");
  rescanButton.textContent = "Re-annotate now";
  rescanButton.onclick = () => {
    refreshStatus();
    rescan();
  };
  root.appendChild(rescanButton);

  return root;
});
