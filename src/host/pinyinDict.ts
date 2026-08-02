// Lazy loader for the complete pinyin dictionary. The dictionary is a ~10MB
// JSON exported from @pinyin-pro/data at build time; it stays out of the main
// bundle and is read from disk only when a Chinese line first appears.

import { isCompleteDictRegistered, registerCompleteDict } from "../engine/pinyin.ts";
import { log } from "./log.ts";

let loading: Promise<boolean> | undefined;

export function ensurePinyinDict(pinyinDictPath: string): Promise<boolean> {
  if (isCompleteDictRegistered()) return Promise.resolve(true);
  loading ??= (async () => {
    try {
      const raw = await betterncm.fs.readFileText(pinyinDictPath);
      registerCompleteDict(JSON.parse(raw));
      log.info("pinyin complete dictionary loaded");
      return true;
    } catch (err) {
      log.warn("pinyin complete dictionary failed to load; using built-in dictionary", err);
      return false;
    }
  })();
  return loading;
}
