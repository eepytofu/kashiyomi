// Locates the plugin folder and the large on-disk assets. During development
// a dev-paths.json in the plugin folder points at the checkout so the 360MB
// dictionary is not copied on every install.

import { log } from "./log.ts";

export type AssetPaths = {
  dictPath: string;
  resourceDir: string;
  pinyinDictPath: string;
  jmdictPath: string;
};

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
  const defaults: AssetPaths = {
    dictPath: `${pluginPath}/assets/dict/system_full.dic`,
    resourceDir: `${pluginPath}/assets/sudachi`,
    pinyinDictPath: `${pluginPath}/assets/pinyin/complete.json`,
    jmdictPath: `${pluginPath}/assets/jmdict/readings.json`,
  };
  try {
    const raw = await betterncm.fs.readFileText(`${pluginPath}/dev-paths.json`);
    const dev = JSON.parse(raw) as Partial<AssetPaths>;
    log.debug("using dev-paths.json overrides");
    return { ...defaults, ...dev };
  } catch {
    return defaults;
  }
}
