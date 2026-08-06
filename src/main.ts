// Kashiyomi entry point. BetterNCM injects the bundled dist/main.js into the
// main NCM page.

import { rescan, startAnnotator } from "./host/annotator.ts";
import { parseApiKeys } from "./engine/apiKeys.ts";
import { log } from "./host/log.ts";
import { nativeInit, nativeState } from "./host/native.ts";
import {
  cancelDictionaryDownload,
  dictionaryInventory,
  dictionaryJob,
  dictionaryListenerCount,
  downloadDictionary,
  installedEditions,
  planDownload,
  reportInventory,
  resolveRelease,
  simulateDictionaryFailure,
  sweepAbandonedDownloads,
} from "./host/dictionary.ts";
import { chooseBootEdition, dictionaryPath } from "./engine/dictionaryLayout.ts";
import { resolveAssetPaths } from "./host/paths.ts";
import { applyStyles } from "./host/styles.ts";
import { getSettings } from "./host/settings.ts";
import { buildConfigPanel } from "./host/configPanel/index.ts";
import { installCopyHandler } from "./host/copy.ts";

async function start(): Promise<void> {
  applyStyles();
  const paths = await resolveAssetPaths();
  if (!paths) {
    log.warn("asset paths unresolved; Japanese analysis disabled");
    return;
  }
  log.info("asset paths", paths);
  // A download killed mid-flight leaves ~69 MB stranded. Sweeping at startup is
  // what stops us being the cause of the full disk we otherwise report politely.
  sweepAbandonedDownloads(paths.dictDir);
  // Load what is on disk, not what settings wish were there. These can disagree
  // — a failed install, a manual delete, a preference changed before the
  // download ran — and the disk is the only one of the two that can be opened.
  const installed = await installedEditions(paths.dictDir);
  const boot = chooseBootEdition(getSettings().dictPreferredEdition, installed);
  log.info(`dictionaries on disk: [${installed.join(", ")}], loading: ${boot.load ?? "none"}`);
  reportInventory(installed, boot.load);
  const status = nativeState();
  log.info("native state:", status.state, status.error ?? "");
  if (boot.load && (status.state === "uninitialized" || status.state === "failed")) {
    nativeInit(dictionaryPath(paths.dictDir, boot.load), paths.resourceDir);
  }
  startAnnotator(paths);
  installCopyHandler();

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
    // Every dictionary failure state on demand, so the messages can be read in
    // the real panel without unplugging anything. Unit tests prove the state
    // machine; they cannot tell whether "could not reach the download" reads
    // like something a person would act on.
    //
    //   kashiyomi.simulateDictFailure("checksum")   then press Download
    //   kashiyomi.simulateDictFailure()             back to normal
    simulateDictFailure: (reason?: string) =>
      simulateDictionaryFailure(reason as never),
    // Runs the real fetch → verify → install → reload path against the data
    // directory, so it can be exercised without clicking and without touching a
    // development checkout's own dictionary.
    downloadDictionary: async (edition: "small" | "core" = "core") => {
      // Deliberately the data directory rather than `paths.dictDir`: under
      // dev-paths.json the latter is the checkout's own assets/dict, and a
      // debug download must not overwrite the dictionary being developed
      // against. The consequence is that in a dev install this exercises the
      // whole path without the result being what the analyzer then loads.
      const dataDir = `${await betterncm.app.getDataPath()}/kashiyomi`.replace(/\\/gu, "/");
      const release = await resolveRelease(edition);
      if (!release) return { error: "no metadata source answered" };
      const paths = await resolveAssetPaths();
      return downloadDictionary(planDownload(release, dataDir), paths?.resourceDir ?? "");
    },
    // Redacted, because this handle is read as routine: the project's own rule
    // is to record kashiyomi.settings() with every live observation, so its
    // output lands in docs, transcripts and screenshots. It returned the key
    // verbatim, and did so once. Debugging needs to know whether translation is
    // configured, never the secret itself. The panel still edits the real value
    // through getSettings directly.
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
