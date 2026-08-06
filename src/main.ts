// Kashiyomi entry point. BetterNCM injects the bundled dist/main.js into the
// main NCM page.

import { rescan, startAnnotator } from "./host/annotator.ts";
import { parseApiKeys } from "./engine/apiKeys.ts";
import { log } from "./host/log.ts";
import { nativeInit, nativeState } from "./host/native.ts";
import {
  cancelDictionaryDownload,
  dictionaryStatus,
  simulateDictionaryFailure,
  sweepAbandonedDownloads,
} from "./host/dictionary.ts";
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
  sweepAbandonedDownloads(paths.dictPath.slice(0, paths.dictPath.lastIndexOf("/")));
  const status = nativeState();
  log.info("native state:", status.state, status.error ?? "");
  if (status.state === "uninitialized" || status.state === "failed") {
    nativeInit(paths.dictPath, paths.resourceDir);
  }
  startAnnotator(paths);
  installCopyHandler();

  // Debug handle for testing from the console.
  (window as unknown as Record<string, unknown>).kashiyomi = {
    state: () => nativeState(),
    rescan,
    dictionary: () => dictionaryStatus(),
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
