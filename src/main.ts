// Kashiyomi entry point. BetterNCM injects the bundled dist/main.js into the
// main NCM page.

import { rescan, startAnnotator } from "./host/annotator.ts";
import { parseApiKeys } from "./engine/apiKeys.ts";
import { log } from "./host/log.ts";
import { nativeInit, nativeState } from "./host/native.ts";
import {
  cancelDictionaryDownload,
  dictionaryInventory,
  forgetDictionaryCheck,
  dictionaryJob,
  dictionaryListenerCount,
  downloadDictionary,
  dictionaryEditionOnDisk,
  planDownload,
  reportInventory,
  resolveRelease,
  simulateDictionaryFailure,
  sweepAbandonedDownloads,
} from "./host/dictionary.ts";
import { dictionaryPath } from "./engine/dictionaryLayout.ts";
import { resolveAssetPaths } from "./host/paths.ts";
import { applyStyles } from "./host/styles.ts";
import { getSettings } from "./host/settings.ts";
import { buildConfigPanel } from "./host/configPanel/index.ts";
import { installCopyHandler } from "./host/copy.ts";
import { openDictionarySetup } from "./host/setup/dialog.ts";

async function start(): Promise<void> {
  applyStyles();
  const paths = await resolveAssetPaths();
  if (!paths) {
    log.warn("asset paths unresolved; Japanese analysis disabled");
    return;
  }
  log.info("asset paths", paths);
  // A download killed mid-flight leaves ~69 MB stranded. Sweeping at startup is
  // what stops the plugin causing the full disk it otherwise reports politely.
  sweepAbandonedDownloads(paths.dictDir);
  // Ask the disk, not the settings. The recorded version and the file can
  // disagree (a failed install, a manual delete), and only one of the two can
  // be opened.
  const installed = await dictionaryEditionOnDisk(paths.dictDir);
  const status = nativeState();
  log.info(`dictionary on disk: ${installed ?? "none"}`);
  log.info("native state:", status.state, status.error ?? "");
  reportInventory(installed);
  if (installed && (status.state === "uninitialized" || status.state === "failed")) {
    nativeInit(dictionaryPath(paths.dictDir, installed), paths.resourceDir);
  }
  startAnnotator(paths);
  installCopyHandler();

  // First run, and only ever once. Two conditions, both required: the user has
  if (!getSettings().dictSetupAnswered && installed === undefined) {
    openDictionarySetup({ firstRun: true });
  }

  // Debug handle for testing from the console.
  (window as unknown as Record<string, unknown>).kashiyomi = {
    state: () => nativeState(),
    rescan,
    dictionary: () => ({
      inventory: dictionaryInventory(),
      job: dictionaryJob(),
      listeners: dictionaryListenerCount(),
    }),
    cancelDictionary: cancelDictionaryDownload,
    // Forget the last update check, so the next settings open asks again.
    forgetDictCheck: forgetDictionaryCheck,
    // The first-run dialog without clicking through to it, which is otherwise
    setup: (firstRun = false) => openDictionarySetup({ firstRun }),
    // Every dictionary failure state on demand, so the messages can be read in
    simulateDictFailure: (reason?: string) =>
      simulateDictionaryFailure(reason as never),
    // Runs the real fetch → verify → install → reload path against the data
    // directory, so it can be exercised without clicking and without touching a
    // development checkout's own dictionary.
    downloadDictionary: async (edition: "core" | "full" = "core") => {
      // Deliberately the data directory rather than `paths.dictDir`: under
      const dataDir = `${await betterncm.app.getDataPath()}/kashiyomi`.replace(/\\/gu, "/");
      const release = await resolveRelease(edition);
      const paths = await resolveAssetPaths();
      return downloadDictionary(
        planDownload(release.release, dataDir, dictionaryInventory().edition),
        paths?.resourceDir ?? "",
      );
    },
    // Redacted, because this handle is read as routine: the project's own rule
    settings: () => {
      const settings = getSettings();
      const count = parseApiKeys(settings.aiApiKey).length;
      return {
        ...settings,
        aiApiKey: count === 0 ? "" : `<redacted: ${count} key${count === 1 ? "" : "s"}>`,
      };
    },
  };
}

plugin.onLoad(() => {
  log.info("loaded");
  void start();
});

plugin.onConfig(() => buildConfigPanel());
