// The whole install sequence, in one place, callable from either surface.
//
// The settings row and the setup dialog both press the same button, and the
// order of operations here is not obvious enough to be worth writing twice:
// resolve, decide whether anything actually needs fetching, ask the disk what
// is already there, download, and only then throw away the annotation cache.
//
// Kept out of `dictionary.ts` because it needs the asset paths, which are the
// annotator's, and out of the panel because the dialog is not the panel.

import { currentAssetPaths } from "./annotator.ts";
import { resetAnalysisCache } from "./analysisCache.ts";
import { rescan } from "./annotator.ts";
import {
  dictionaryInventory,
  downloadDictionary,
  installedEditions,
  planDownload,
  reportNoSource,
  reportUpToDate,
  resolveRelease,
  type DownloadPlan,
} from "./dictionary.ts";
import { updateSettings } from "./settings.ts";
import type { DictionaryEdition } from "../engine/dictionarySource.ts";

/**
 * Fetch and install `edition`, reporting through the dictionary job.
 *
 * `edition` may differ from the user's preference when the view offered a
 * smaller one that fits. Taking that offer is a choice, so it is recorded as
 * one: otherwise the next launch tries the edition that does not fit all over
 * again.
 */
export async function startDictionaryInstall(edition: DictionaryEdition): Promise<void> {
  const paths = currentAssetPaths();
  if (!paths) return;
  updateSettings({ dictPreferredEdition: edition });

  // Resolve live so an update gets the newest release; fall back to the pinned
  // one, which is always installable even with every source blocked.
  const { release, checked } = await resolveRelease(edition);

  // Nothing to do if the installed dictionary is already this release.
  // Re-downloading 69 MB to arrive at the same file is not an update, and the
  // button was happy to do it as often as it was pressed. Asked per edition, so
  // switching away and back does not re-fetch a file whose version is recorded.
  const inventory = dictionaryInventory();
  if (
    inventory.installed.includes(release.edition) &&
    inventory.versions[release.edition] === release.version
  ) {
    // The one honest use of `no-source`: already at the pinned version, and
    // nothing answered when asked whether a newer one exists. Saying "already
    // the newest release" there would report an answer never received.
    if (checked) reportUpToDate(release.edition);
    else reportNoSource(release.edition);
    return;
  }

  // Ask the disk what is there, so switching edition can hand the backend the
  // file it supersedes and reclaim its 207 MB once the new one loads.
  const dir = paths.dictDir;
  const plan: DownloadPlan = planDownload(release, dir, await installedEditions(dir));
  const result = await downloadDictionary(plan, paths.resourceDir);

  // A new dictionary changes every reading in the song. The annotation cache is
  // keyed by line text, so rescan alone would put every line back with its old
  // reading and the whole download would look like it did nothing.
  if (result.kind === "idle") {
    resetAnalysisCache();
    void rescan();
  }
}
