// Downloading, verifying and switching the Sudachi dictionary.
//
// Splits the work where each side is strong: `fetch` here, because it is
// already HTTPS, already streams, and already honours whatever proxy the user
// has configured — a Rust client would need all three written by hand, and the
// users who most need a proxy are exactly the ones this feature exists for.
// Verification and extraction happen natively, because the extracted
// dictionary is 207 MB and has no business in this heap.
//
// Policy — which source to try, what each failure means, whether an edition
// fits the disk — lives in `engine/dictionarySource.ts` so it can be tested
// without a network.

import {
  SIMPLE_INDEX_ACCEPT,
  dictionarySupply,
  installableFull,
  metadataSources,
  parsePypiRelease,
  parseSimpleIndexRelease,
  requiredFreeBytes,
  resolveFullFromPypi,
  type DictionaryEdition,
  type DictionaryFailure,
  type DictionaryRelease,
} from "../engine/dictionarySource.ts";
import {
  archivePath,
  dictionaryPath,
  installedEditionsFrom,
} from "../engine/dictionaryLayout.ts";
import {
  pruneVersions,
  withVersion,
  type DictionaryInventory,
  type DictionaryJob,
} from "../engine/dictionaryState.ts";
import { pinnedRelease } from "../engine/dictionaryPins.ts";
import { log } from "./log.ts";
import { getSettings, updateSettings } from "./settings.ts";
import {
  nativeFreeSpace,
  nativeInstallDictionary,
  nativeSweepPartials,
} from "./native.ts";

let inventory: DictionaryInventory = { installed: [], versions: {}, loaded: undefined };
let job: DictionaryJob = { kind: "idle" };
let inFlight = false;
let abort: AbortController | undefined;
const listeners = new Set<() => void>();

/** What exists on disk and what the analyzer opened. */
export function dictionaryInventory(): DictionaryInventory {
  return inventory;
}

/** What an install is doing, including how the last one failed. */
export function dictionaryJob(): DictionaryJob {
  return job;
}

/**
 * How many things are currently following the dictionary.
 *
 * On the debug handle rather than in a test, because the failure it catches is
 * a leak across panel rebuilds and the only place that actually happens is a
 * running NCM. Anything other than one open panel meaning one listener is a
 * teardown that did not run.
 */
export function dictionaryListenerCount(): number {
  return listeners.size;
}

/**
 * Notify a listener whenever either changes, whoever changed it.
 *
 * The settings row used to repaint only in response to its own button, so a
 * download started anywhere else — the debug handle, and in future an automatic
 * first fetch — left it reading "not installed" over a dictionary that was
 * installed and working. A control whose whole job is reporting state has to
 * follow the state rather than its own last click.
 */
export function onDictionaryChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce(): void {
  for (const listener of listeners) listener();
}

function setJob(next: DictionaryJob): DictionaryJob {
  job = next;
  lastProgressAnnounce = 0;
  announce();
  return job;
}

/**
 * The shortest gap between two progress announcements.
 *
 * A `ReadableStream` over a 69 MB transfer hands back roughly a thousand chunks,
 * and every one of them used to notify every listener, each of which repaints a
 * row whose smallest visible step is 0.1 MB. Nothing could see most of that
 * work. At 250 ms the bar still moves continuously to a human and the panel
 * repaints a few dozen times instead of a thousand.
 */
const PROGRESS_ANNOUNCE_MS = 250;
let lastProgressAnnounce = 0;

/**
 * Record progress every chunk, tell anyone about it far less often.
 *
 * The value has to stay current because the row also samples it on a timer, so
 * this is a coalesced *notification*, never a coalesced measurement: a reader
 * that arrives between announcements still sees the true byte count.
 */
function setProgress(next: DictionaryJob): void {
  job = next;
  const now = Date.now();
  if (now - lastProgressAnnounce < PROGRESS_ANNOUNCE_MS) return;
  lastProgressAnnounce = now;
  announce();
}

/**
 * Publish what the disk holds, pruning versions for editions no longer on it.
 *
 * Takes the listing rather than reading it, because boot has already read the
 * directory to decide what to load and reading it twice invites the two answers
 * to differ.
 */
export function reportInventory(
  installed: readonly DictionaryEdition[],
  loaded: DictionaryEdition | undefined,
): void {
  const versions = pruneVersions(getSettings().dictVersions, installed);
  updateSettings({ dictVersions: versions });
  inventory = { installed, versions, loaded };
  announce();
}

/**
 * Which editions are on disk, asked of the disk.
 *
 * This used to take the *preferred* edition's path and, on finding any file
 * there, report whatever edition settings claimed — so a machine holding
 * `system_small.dic` while settings said `core` was described as having core
 * installed, and the analyzer was then pointed at a file that did not exist.
 * Settings record what the user wants; only the directory knows what arrived.
 */
export async function installedEditions(
  dictDir: string,
): Promise<readonly DictionaryEdition[]> {
  try {
    return installedEditionsFrom(await betterncm.fs.readDir(dictDir));
  } catch {
    // A missing data directory on a fresh install is the normal path here, not
    // an error: nothing is installed, which is exactly what an empty list says.
    return [];
  }
}

/**
 * Re-read the directory and publish what is actually there.
 *
 * Used after an install, where the alternative is predicting the new contents
 * from the plan. The prediction has two branches that are easy to get wrong (a
 * superseded edition is deleted only once the new one loads, and a rename that
 * lands before a failed load still leaves the file) and the disk can simply be
 * asked.
 */
async function refreshInventory(
  dictDir: string,
  loaded: DictionaryEdition | undefined,
): Promise<void> {
  reportInventory(await installedEditions(dictDir), loaded);
}

/**
 * Stop an in-flight download. Nothing has been written to the live path by this
 * point, so cancelling is always safe and leaves the working dictionary alone.
 */
export function cancelDictionaryDownload(): void {
  abort?.abort();
}

/**
 * Force the next attempt to fail a given way, for checking the messages read
 * sensibly. Wired to `kashiyomi.simulateDictFailure` — unit tests can prove the
 * state machine but cannot judge wording, and wording is what a user meets.
 */
let simulated: DictionaryFailure | undefined;
export function simulateDictionaryFailure(reason: DictionaryFailure | undefined): void {
  simulated = reason;
}

/**
 * Resolve the newest release, trying each source in turn.
 *
 * Falls through on **failure**, never on a guess about where the user is: a
 * mainland connection reaches the mirror naturally and everyone else never
 * learns it exists. Returns undefined only when every source refused, which is
 * the one failure with no in-plugin recovery.
 */
export async function resolveRelease(
  edition: DictionaryEdition,
): Promise<DictionaryRelease | undefined> {
  setJob({ kind: "resolving", edition });
  if (edition === "full") return (await resolveFull()).release;
  const sources = metadataSources(edition);
  for (const [index, url] of sources.entries()) {
    const isSimpleIndex = index > 0;
    try {
      const response = await fetch(url, {
        headers: isSimpleIndex ? { accept: SIMPLE_INDEX_ACCEPT } : {},
      });
      if (!response.ok) continue;
      const body: unknown = await response.json();
      const release = isSimpleIndex
        ? parseSimpleIndexRelease(edition, body)
        : parsePypiRelease(edition, body);
      if (release) return release;
    } catch (err) {
      log.debug(`dictionary metadata source failed: ${url}`, err);
    }
  }
  // Every source refused. Clear the job rather than leaving it resolving
  // forever, which would keep the button disabled with nothing running.
  setJob({ kind: "idle" });
  return undefined;
}

/**
 * The update check found nothing newer.
 *
 * A job state rather than a flag plus a `setTimeout` in the row: `at` lets the
 * row decide how long to say so, and a rebuilt panel cannot strand a timer that
 * writes to a row that is gone.
 */
export function reportUpToDate(edition: DictionaryEdition): void {
  setJob({ kind: "upToDate", edition, at: Date.now() });
}

/**
 * Resolve `full`, which is always installable at the pinned version and never
 * installable above it.
 *
 * Reports `newerVersion` when upstream has moved on, so the row can say a newer
 * release exists and needs a plugin update — rather than either lying that it
 * is current or fetching 121 MB nothing can verify. A metadata failure is not
 * an error here: the pinned release is still the right thing to install.
 */
export async function resolveFull(): Promise<{
  release: DictionaryRelease;
  newerVersion?: string;
}> {
  const pinned = pinnedRelease("full");
  try {
    const response = await fetch("https://pypi.org/pypi/SudachiDict-full/json");
    if (response.ok) {
      const outcome = resolveFullFromPypi(await response.json(), pinned);
      if (outcome.kind === "newer") {
        return { release: installableFull(pinned), newerVersion: outcome.version };
      }
      return { release: outcome.release };
    }
  } catch (err) {
    log.debug("could not check for a newer full release", err);
  }
  return { release: installableFull(pinned) };
}

export type DownloadPlan = {
  readonly release: DictionaryRelease;
  /** Where the archive is staged; beside the target so the rename is atomic. */
  readonly archivePath: string;
  readonly targetPath: string;
  /** Path inside the wheel. */
  readonly member: string;
  /** The directory both live in, so callers stop slicing it back out of a path. */
  readonly directory: string;
  /**
   * A dictionary this install replaces, deleted once the new one loads.
   *
   * Only ever set when switching to a *different* edition — an update writes
   * the same filename, so there is nothing left over. Without this, switching
   * core to small left 207 MB of a dictionary nothing would open again, on a
   * disk the user had just been asked to make room on.
   */
  readonly superseded?: string;
};

export function planDownload(
  release: DictionaryRelease,
  dictionaryDir: string,
  installed: readonly DictionaryEdition[] = [],
): DownloadPlan {
  const replaced = installed.filter((edition) => edition !== release.edition);
  return {
    release,
    archivePath: archivePath(dictionaryDir, release.edition, release.version),
    targetPath: dictionaryPath(dictionaryDir, release.edition),
    // The wheel and the vendor zip lay the dictionary out differently, so this
    // is a lookup rather than a constant.
    member: dictionarySupply(release.edition, release.version).member,
    directory: dictionaryDir,
    superseded: replaced[0] ? dictionaryPath(dictionaryDir, replaced[0]) : undefined,
  };
}

/**
 * Fetch, verify, install, and load — in that order, and never any other.
 *
 * The old dictionary is only replaced by a rename of a file that has already
 * been hash-checked and extracted, so a failure at any step leaves the working
 * dictionary in place. Nothing here writes to the live path.
 *
 * Guarded against re-entry: two concurrent writers to one path is the one race
 * that could corrupt a good install, and pressing a button twice is the easiest
 * way to cause it.
 */
export async function downloadDictionary(
  plan: DownloadPlan,
  resourceDir: string,
): Promise<DictionaryJob> {
  if (inFlight) return job;
  inFlight = true;
  abort = new AbortController();
  const edition = plan.release.edition;
  try {
    if (simulated) return fail(edition, simulated);
    // Before the bandwidth, not after: the archive and its 207 MB extraction
    // exist at once, and a disk that cannot hold both should say so now.
    const dir = plan.directory;
    const free = nativeFreeSpace(dir);
    if (free !== undefined && free < requiredFreeBytes(plan.release.size)) {
      log.info(
        `dictionary needs ${requiredFreeBytes(plan.release.size)} bytes free, ${free} available`,
      );
      return fail(edition, "disk-space");
    }

    // The data directory does not exist on a fresh install, and writeFile does
    // not create it — the first real run failed here with "cannot find the path
    // specified" after downloading the whole archive.
    try {
      await betterncm.fs.mkdir(dir);
    } catch (err) {
      log.debug("could not create the dictionary directory", err);
    }

    setJob({ kind: "downloading", edition, received: 0, total: plan.release.size });
    const archive = await fetchArchive(plan);
    if (!archive.ok) return fail(edition, archive.reason);

    setJob({ kind: "installing", edition });
    const installed = nativeInstallDictionary(
      plan.archivePath,
      plan.release.sha256,
      plan.member,
      plan.targetPath,
      resourceDir,
      plan.superseded,
    );
    if (!installed.ok) {
      // The backend already discarded the archive and any staging; the message
      // distinguishes a corrupt download from a full disk.
      log.info(`dictionary install failed: ${installed.error}`);
      return fail(edition, /checksum/u.test(installed.error) ? "checksum" : "extract");
    }

    // Recorded before the load is judged, not after. The bytes are verified and
    // in place by this point, so forgetting the version because a load was
    // momentarily busy used to cost another 69 MB to learn a date string
    // already on the disk. The preference is deliberately not touched: it is
    // the user's, and an install is not a statement about what they want.
    updateSettings({
      dictVersions: withVersion(getSettings().dictVersions, edition, plan.release.version),
    });
    await refreshInventory(plan.directory, installed.started ? edition : undefined);
    if (!installed.started) return fail(edition, "load");
    return setJob({ kind: "idle" });
  } finally {
    inFlight = false;
    abort = undefined;
  }
}

function fail(edition: DictionaryEdition, reason: DictionaryFailure): DictionaryJob {
  return setJob({ kind: "failed", edition, reason, at: Date.now() });
}

/**
 * Stream the archive to disk, updating progress as it goes.
 *
 * Read through a `ReadableStream` rather than awaiting `.blob()` so the status
 * can move while a 69 MB transfer is in flight — a progress bar that only moves
 * at the end is worse than none.
 */
async function fetchArchive(plan: DownloadPlan): Promise<{ ok: true } | { ok: false; reason: DictionaryFailure }> {
  try {
    const response = await fetch(plan.release.url, { signal: abort?.signal });
    if (!response.ok || !response.body) return { ok: false, reason: "offline" };
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      received += value.byteLength;
      setProgress({
        kind: "downloading",
        edition: plan.release.edition,
        received,
        total: plan.release.size,
      });
    }
    await betterncm.fs.writeFile(plan.archivePath, new Blob(chunks as BlobPart[]));
    return { ok: true };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, reason: "cancelled" };
    }
    log.info("dictionary download failed", err);
    return { ok: false, reason: "offline" };
  }
}

/** Startup housekeeping: drop anything an interrupted download left behind. */
export function sweepAbandonedDownloads(dictionaryDir: string): void {
  const removed = nativeSweepPartials(dictionaryDir);
  if (removed > 0) log.info(`removed ${removed} abandoned dictionary download(s)`);
}
