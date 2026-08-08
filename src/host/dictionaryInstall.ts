// The whole install sequence, in one place, callable from either surface.

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

/** Fetch and install the dictionary, reporting through the dictionary job. */
export async function startDictionaryInstall(): Promise<void> {
  const paths = currentAssetPaths();
  if (!paths) return;

  // Resolve live so an update gets the newest release; fall back to the pinned
  // one, which is always installable even with every source blocked.
  const { release, checked } = await resolveRelease();

  // Nothing to do if what is on disk is already this release. Re-downloading
  // 69 MB to arrive at the same file is not an update, and the button was happy
  // to do it as often as it was pressed.
  const inventory = dictionaryInventory();
  if (inventory.installed && inventory.version === release.version) {
    // Both branches must end the job, not just record what they learned:
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
