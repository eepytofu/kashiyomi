// Locates the plugin folder and the large on-disk assets. During development
// a dev-paths.json in the plugin folder points at the checkout so the 360MB
// dictionary is not copied on every install.

import { log } from "./log.ts";

export type AssetPaths = {
  /**
   * The directory holding the dictionaries, not a file.
   *
   * It was a path to one file, hardcoded to `system_core.dic` while downloads
   * wrote `system_<edition>.dic` — so installing `small` loaded nothing after
   * the next restart. Which file to open is `chooseBootEdition`'s answer, and
   * it depends on what is actually on disk.
   */
  dictDir: string;
  resourceDir: string;
  pinyinDictPath: string;
  jmdictPath: string;
};

/** Accepts a `dev-paths.json` written before `dictPath` became `dictDir`. */
type DevPaths = Partial<AssetPaths> & { dictPath?: string };

export function findPluginPath(): string | undefined {
  const direct = (plugin as { pluginPath?: string }).pluginPath;
  if (typeof direct === "string" && direct !== "") return direct;
  if (typeof loadedPlugins === "object" && loadedPlugins) {
    for (const key of ["kashiyomi", "Kashiyomi"]) {
      const entry = loadedPlugins[key];
      if (entry?.pluginPath) return entry.pluginPath;
    }
    log.debug("loadedPlugins keys:", Object.keys(loadedPlugins));
  }
  return undefined;
}

export async function resolveAssetPaths(): Promise<AssetPaths | undefined> {
  const pluginPath = findPluginPath();
  if (!pluginPath) {
    log.warn("could not determine plugin path");
    return undefined;
  }
  // **The dictionary lives outside the plugin folder, and that is not a
  // preference.** A released plugin is a `.plugin` zip in `plugins\`, extracted
  // into `plugins_runtime\` — a cache BetterNCM rebuilds from the zip on every
  // NCM start. Anything written into the plugin's own directory is destroyed on
  // the next launch, so a 207 MB dictionary kept there would be downloaded
  // again every single time NCM opens.
  //
  // The data directory persists and is already where `kashiyomi.log` lives.
  // Nothing in the BetterNCM wiki documents a convention for this, so the
  // reasoning is the platform's observed behaviour rather than a rule.
  const dataDir = `${await betterncm.app.getDataPath()}/kashiyomi`.replace(/\\/gu, "/");
  const defaults: AssetPaths = {
    dictDir: dataDir,
    resourceDir: `${pluginPath}/assets/sudachi`,
    pinyinDictPath: `${pluginPath}/assets/pinyin/complete.json`,
    jmdictPath: `${pluginPath}/assets/jmdict/readings.json`,
  };
  try {
    const raw = await betterncm.fs.readFileText(`${pluginPath}/dev-paths.json`);
    const dev = JSON.parse(raw) as DevPaths;
    log.debug("using dev-paths.json overrides");
    const { dictPath, ...rest } = dev;
    // An older dev-paths.json names the .dic itself. Take its directory rather
    // than ignoring the override, which would silently point a dev install at
    // the real data directory and download a dictionary it already has.
    const legacy = dictPath ? { dictDir: directoryOf(dictPath) } : {};
    return { ...defaults, ...legacy, ...rest };
  } catch {
    return defaults;
  }
}

function directoryOf(filePath: string): string {
  const normalised = filePath.replace(/\\/gu, "/");
  const cut = normalised.lastIndexOf("/");
  return cut === -1 ? normalised : normalised.slice(0, cut);
}
