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
  dictionaryOnDisk,
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
  const installed = await dictionaryOnDisk(paths.dictDir);
  const status = nativeState();
  log.info(`dictionary on disk: ${installed}`);
  log.info("native state:", status.state, status.error ?? "");
  // Ask the analyzer whether it has the file open rather than passing a
  // constant. Reported as always-false, the debug handle said `loaded: false`
  // over a dictionary the analyzer had ready, which is the one thing that
  // handle exists to answer.
  reportInventory(installed, status.state === "ready");
  if (installed && (status.state === "uninitialized" || status.state === "failed")) {
    nativeInit(dictionaryPath(paths.dictDir), paths.resourceDir);
  }
  startAnnotator(paths);
  installCopyHandler();

  // First run, and only ever once. Two conditions, both required: the user has
  // not answered before, and there is genuinely no dictionary. The second is
  // what makes this self-clearing, so there is no "have they seen it" flag that
  // can get out of step with reality.
  //
  // Raised here rather than from the panel because the whole problem is that a
  // new install shows no furigana and says nothing about why, and the settings
  // panel is the place someone goes *after* deciding something is wrong.
  if (getSettings().dictSetupSeen === "" && !installed) {
    openDictionarySetup();
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
    // Without it a twelve-hour throttle that persists across restarts can only
    // be exercised by hand-editing settings, which tests the blob rather than
    // the code.
    forgetDictCheck: forgetDictionaryCheck,
    // The first-run dialog without clicking through to it, which is otherwise
    // reachable only on a machine that has never had a dictionary. There is no
    // settings button for it: re-running a first-run prompt is a thing to test,
    // not a thing to offer.
    setup: () => openDictionarySetup(),
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
    downloadDictionary: async () => {
      // Deliberately the data directory rather than `paths.dictDir`: under
      // dev-paths.json the latter is the checkout's own assets/dict, and a
      // debug download must not overwrite the dictionary being developed
      // against. The consequence is that in a dev install this exercises the
      // whole path without the result being what the analyzer then loads.
      const dataDir = `${await betterncm.app.getDataPath()}/kashiyomi`.replace(/\\/gu, "/");
      const release = await resolveRelease();
      const paths = await resolveAssetPaths();
      return downloadDictionary(planDownload(release.release, dataDir), paths?.resourceDir ?? "");
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
