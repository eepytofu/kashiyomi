// Kashiyomi entry point. BetterNCM injects this bundle into the NCM renderer.

import { parseApiKeys } from "./engine/apiKeys.ts";
import { resetAnalysisCache } from "./host/analysisCache.ts";
import { rescan, startAnnotator } from "./host/annotator.ts";
import { buildConfigPanel } from "./host/configPanel/index.ts";
import { installCopyHandler } from "./host/copy.ts";
import {
  activateDictionary,
  cancelDictionary,
  configureDictionary,
  dictionaryListenerCount,
  dictionarySnapshot,
  installDictionary,
  onDictionaryChange,
  removeDictionary,
  waitForDictionaryRecovery,
} from "./host/dictionary.ts";
import { log } from "./host/log.ts";
import { resolveAssetPaths } from "./host/paths.ts";
import { getSettings, legacyDictionaryPreference } from "./host/settings.ts";
import { openDictionarySetup } from "./host/setup/dialog.ts";
import { applyStyles } from "./host/styles.ts";

async function start(): Promise<void> {
  applyStyles();
  const paths = await resolveAssetPaths();
  if (!paths) {
    log.warn("asset paths unresolved; Japanese analysis disabled");
    return;
  }
  log.info("asset paths", paths);
  const configured = configureDictionary(paths.dictDir, paths.resourceDir, legacyDictionaryPreference());
  if (!configured.ok) log.warn("dictionary configuration failed", configured.errorCode);

  startAnnotator(paths);
  installCopyHandler();

  let served = `${dictionarySnapshot().active ?? "none"}:${dictionarySnapshot().analyzer.state}`;
  onDictionaryChange(() => {
    const snapshot = dictionarySnapshot();
    const next = `${snapshot.active ?? "none"}:${snapshot.analyzer.state}`;
    if (next === served) return;
    served = next;
    resetAnalysisCache();
    rescan();
  });

  const recovered = await waitForDictionaryRecovery();
  if (!getSettings().dictSetupAnswered && recovered.installed.length === 0) {
    openDictionarySetup({ firstRun: true });
  }

  (window as unknown as Record<string, unknown>).kashiyomi = {
    state: dictionarySnapshot,
    rescan,
    dictionary: () => ({ ...dictionarySnapshot(), listeners: dictionaryListenerCount() }),
    setup: (firstRun = false) => openDictionarySetup({ firstRun }),
    installDictionary,
    activateDictionary,
    removeDictionary,
    cancelDictionary,
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
