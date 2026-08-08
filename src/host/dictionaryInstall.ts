// The whole install sequence, in one place, callable from either surface.
//
// The settings row and the setup dialog both press the same button, and the
// order of operations here is not obvious enough to be worth writing twice:
// resolve, decide whether anything actually needs fetching, download, and only
// then throw away the annotation cache.
//
// Kept out of `dictionary.ts` because it needs the asset paths, which are the
// annotator's, and out of the panel because the dialog is not the panel.

import { currentAssetPaths } from "./annotator.ts";
import { resetAnalysisCache } from "./analysisCache.ts";
import { rescan } from "./annotator.ts";
import {
  dictionaryInventory,
  downloadDictionary,
  planDownload,
  reportNoSource,
  reportUpToDate,
  recordCheck,
  resolveRelease,
  type DownloadPlan,
} from "./dictionary.ts";

/**
 * Fetch and install the dictionary, reporting through the dictionary job.
 *
 * Serves both the first install and every later update, which are the same
 * sequence: the only difference is whether anything is on disk to compare
 * against, and that is a question about the version rather than about which
 * button was pressed.
 */
export async function startDictionaryInstall(): Promise<void> {
  const paths = currentAssetPaths();
  if (!paths) return;

  // Resolve live so an update gets the newest release; fall back to the pinned
  // one, which is always installable even with every source blocked.
  const { release, checked } = await resolveRelease();

  // Nothing to do if what is on disk is already this release. Re-downloading
  // 69 MB to arrive at the same file is not an update, and the button was happy
  // to do it as often as it was pressed.
  //
  // The recorded version is only known for a dictionary this plugin installed.
  // One placed by `npm run fetch-dict` has none, so this correctly declines to
  // claim it is current and lets the install proceed.
  const inventory = dictionaryInventory();
  if (inventory.installed && inventory.version === release.version) {
    // Both branches must end the job, not just record what they learned:
    // `resolveRelease` set `resolving` on the way in. `no-source` is the honest
    // one when nothing answered — already at the pinned version, so claiming
    // "already the newest release" would report an answer never received.
    if (checked) reportUpToDate();
    else reportNoSource();
    return;
  }

  const plan: DownloadPlan = planDownload(release, paths.dictDir);
  const result = await downloadDictionary(plan, paths.resourceDir);

  // A new dictionary changes every reading in the song. The annotation cache is
  // keyed by line text, so rescan alone would put every line back with its old
  // reading and the whole download would look like it did nothing.
  if (result.kind === "idle") {
    // The install just proved what the newest release is, so the next open has
    // nothing to ask about.
    recordCheck();
    resetAnalysisCache();
    void rescan();
  }
}
