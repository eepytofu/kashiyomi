// Lazy loader for the JMdict reading asset. The asset is a ~3MB JSON built by
// `npm run export-jmdict`; it stays out of the main bundle and is read from
// disk only when a Japanese line first appears.

import { jmdictReadings, type JmdictReadings } from "../engine/jmdictReadings.ts";
import { log } from "./log.ts";

let loading: Promise<JmdictReadings | undefined> | undefined;

export function ensureJmdictReadings(
  jmdictPath: string,
): Promise<JmdictReadings | undefined> {
  loading ??= (async () => {
    try {
      const raw = await betterncm.fs.readFileText(jmdictPath);
      const map = JSON.parse(raw) as Record<string, string>;
      log.info(`jmdict readings loaded (${Object.keys(map).length} surfaces)`);
      return jmdictReadings(map);
    } catch (err) {
      log.warn("jmdict readings failed to load; abstentions stay unread", err);
      return undefined;
    }
  })();
  return loading;
}
