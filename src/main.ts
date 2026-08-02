// Kashiyomi entry point. BetterNCM injects the bundled dist/main.js into the
// main NCM page.

import { rescan, startAnnotator } from "./host/annotator.ts";
import { log } from "./host/log.ts";
import { nativeInit, nativeState } from "./host/native.ts";
import { resolveAssetPaths } from "./host/paths.ts";
import { applyStyles } from "./host/render.ts";
import { diagnoseLayout } from "./host/diagnose.ts";
import { getSettings } from "./host/settings.ts";
import { buildConfigPanel } from "./host/configPanel.ts";

async function start(): Promise<void> {
  applyStyles();
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
    diagnose: diagnoseLayout,
    rescan,
    settings: getSettings,
  };
}

plugin.onLoad(() => {
  log.info("loaded");
  void start();
});

plugin.onConfig(() => buildConfigPanel());
