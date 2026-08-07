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
  downloadUrls,
  metadataSources,
  confirmsPinned,
  dictionaryMember,
  parseGithubRelease,
  parsePypiRelease,
  parseSimpleIndexRelease,
  requiredFreeBytes,
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
  nativeReload,
  nativeCancelInstall,
  nativeDictStatus,
  nativeStartInstall,
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
 * running NCM.
 *
 * **The number is not one.** An open settings panel is two: the dictionary row
 * repaints itself, and the Japanese card's gate greys the settings that need a
 * dictionary. The setup dialog adds a third while it is open. What matters is
 * that the count returns to its baseline after a rebuild or a close, not that
 * it equals any particular figure, so read it twice rather than once.
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
 * Stop whatever the current attempt is doing, wherever it has got to.
 *
 * Three mechanisms because there are three kinds of work, and one signal cannot
 * reach all of them: the metadata check and the transfer are `fetch` calls
 * behind an `AbortController`, while verifying and unpacking happen on a native
 * worker that only sees a flag it polls between chunks.
 *
 * Safe at every point it is accepted. Nothing is written to the live path until
 * the swap, and the swap is exactly where the native side stops agreeing to be
 * cancelled.
 */
export function cancelDictionaryDownload(): void {
  abort?.abort();
  nativeCancelInstall();
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
export type ResolvedRelease = {
  readonly release: DictionaryRelease;
  /**
   * False when every metadata source refused and this is the build-time pin.
   *
   * The distinction is the whole of `no-source`: an install can go ahead on the
   * pin, but an *update check* cannot honestly report "already the newest" when
   * nothing answered the question.
   */
  readonly checked: boolean;
};

export async function resolveRelease(edition: DictionaryEdition): Promise<ResolvedRelease> {
  // The attempt's abort signal starts here, not at the download: an update
  // check against a source that is timing out is exactly when someone reaches
  // for Cancel, and there was nothing to press it against.
  abort = new AbortController();
  setJob({ kind: "resolving", edition });

  // One loop for every edition. `full` used to branch out to its own resolver
  // because PyPI could describe it but never serve it; now that GitHub carries
  // the wheel and its digest, it is just an edition with a shorter source list.
  for (const source of metadataSources(edition)) {
    try {
      const response = await fetch(source.url, {
        headers:
          source.kind === "simple"
            ? { accept: SIMPLE_INDEX_ACCEPT }
            : source.kind === "github"
              ? { accept: "application/vnd.github+json" }
              : {},
        signal: abort.signal,
      });
      if (!response.ok) continue;
      const body: unknown = await response.json();
      const release =
        source.kind === "simple"
          ? parseSimpleIndexRelease(edition, body)
          : source.kind === "github"
            ? parseGithubRelease(edition, body)
            : parsePypiRelease(edition, body);
      if (!release) continue;
      if (source.trusted) return { release, checked: true };
      // An untrusted source supplies the digest an install would be checked
      // against, so it is allowed to confirm the pinned release and nothing
      // else. A newer version from here is ignored rather than fetched: the
      // build has no digest for it, and the source that offered it is the one
      // that would also be supplying that digest.
      const pinned = pinnedRelease(edition);
      if (confirmsPinned(release, pinned)) return { release: pinned, checked: true };
      log.debug(`ignoring an unverifiable release from ${source.url}`);
    } catch (err) {
      // A cancel must end the whole attempt, not advance to the next source.
      // Falling through would have Cancel walk the list one press at a time.
      if (err instanceof Error && err.name === "AbortError") {
        fail(edition, "cancelled");
        return { release: pinnedRelease(edition), checked: false };
      }
      log.debug(`dictionary metadata source failed: ${source.url}`, err);
    }
  }
  // Every source refused. The pinned release is still installable, because the
  // pin carries its own URL, so a blocked upstream no longer means no dictionary
  // at all. `checked: false` is what stops the caller reporting "already the
  // newest" off the back of a question nothing answered.
  setJob({ kind: "idle" });
  return { release: pinnedRelease(edition), checked: false };
}

/**
 * Load an edition that is already on disk, downloading nothing.
 *
 * Switching between two installed editions used to be indistinguishable from
 * "you are already up to date": both reach the same branch, because both mean
 * the wanted release is on disk. So the picker changed, the row said nothing
 * was needed, and the analyzer went on serving the edition it already had until
 * the next launch, where `chooseBootEdition` quietly sorted it out.
 *
 * This is the one caller of `nativeReload`, which was left unreferenced when
 * installing became a single native call. It is not dead code, it is the switch
 * that had no button.
 */
export async function switchToInstalled(
  edition: DictionaryEdition,
  dictDir: string,
  resourceDir: string,
): Promise<DictionaryJob> {
  if (inFlight) return job;
  inFlight = true;
  try {
    // `loading` rather than a phase of its own: from the outside this is the
    // tail of an install with the fetching and unpacking already done.
    setJob({ kind: "installing", edition, phase: "loading", done: 0, total: 0 });
    if (!nativeReload(dictionaryPath(dictDir, edition), resourceDir)) {
      // False means a load was already running, not that the file is bad.
      return fail(edition, "load");
    }
    await refreshInventory(dictDir, edition);
    return setJob({ kind: "idle" });
  } finally {
    inFlight = false;
  }
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
 * The update check itself failed, with this edition already at the pinned
 * version so there is nothing to install instead.
 *
 * The only place  is set. It used to be declared and never
 * reachable, which meant the row could never say the difference between
 * "nothing newer exists" and "nobody answered".
 */
export function reportNoSource(edition: DictionaryEdition): void {
  setJob({ kind: "failed", edition, reason: "no-source", at: Date.now() });
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
    member: dictionaryMember(release.edition),
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
  // Reuse the controller `resolveRelease` opened for this attempt rather than
  // replacing it. A fresh one would drop the signal for the moment between the
  // update check finishing and the transfer starting, where Cancel is on screen
  // and enabled and would have quietly done nothing.
  abort = abort ?? new AbortController();
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

    setJob({ kind: "installing", edition, phase: "verifying", done: 0, total: 0 });
    const started = nativeStartInstall(
      plan.archivePath,
      plan.release.sha256,
      plan.member,
      plan.targetPath,
      resourceDir,
      plan.superseded,
    );
    if (!started.ok) {
      log.info(`dictionary install failed: ${started.error}`);
      return fail(edition, "extract");
    }
    if (!started.started) {
      // A worker is already installing something. Refusing is the guard against
      // two threads renaming onto the same target, so this is not an error.
      log.info("an install is already running");
      return job;
    }

    const installed = await awaitInstall(edition);
    if (!installed.ok) {
      // The backend already discarded the archive and any staging. Cancelling is
      // reported as its own outcome by the worker rather than inferred from a
      // message, so a genuine failure that happens to mention the word cannot
      // be mistaken for one the user asked for.
      if (installed.cancelled) return fail(edition, "cancelled");
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

/** How often the worker thread is asked how it is getting on. */
const INSTALL_POLL_MS = 150;

/**
 * Follow the worker to its end, republishing each phase as it goes.
 *
 * Progress is coalesced the same way the download is: the phase and byte count
 * are recorded every poll, but listeners hear about it on the slower cadence,
 * because a 207 MB extract at 150 ms is still far more repaints than a row
 * measured in tenths of a megabyte can show.
 */
type InstallOutcome =
  | { ok: true; started: boolean }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled?: false; error: string };

async function awaitInstall(edition: DictionaryEdition): Promise<InstallOutcome> {
  for (;;) {
    await new Promise((resolve) => window.setTimeout(resolve, INSTALL_POLL_MS));
    const status = nativeDictStatus();
    if (!status) return { ok: false, error: "the analyzer backend is unavailable" };
    const native = status.job;
    if (native.kind === "running") {
      setProgress({
        kind: "installing",
        edition,
        phase: native.phase,
        done: native.done,
        total: native.total,
      });
      continue;
    }
    if (native.kind === "cancelled") return { ok: false, cancelled: true };
    if (native.kind === "failed") return { ok: false, error: native.message };
    if (native.kind === "done") return { ok: true, started: native.started };
    // `idle` here means the worker finished and something else already consumed
    // the result, which only one caller can do because `inFlight` guards this
    // whole function. Treat it as done rather than looping forever.
    return { ok: true, started: true };
  }
}

/**
 * Stream the archive to disk, updating progress as it goes.
 *
 * Read through a `ReadableStream` rather than awaiting `.blob()` so the status
 * can move while a 69 MB transfer is in flight — a progress bar that only moves
 * at the end is worse than none.
 */
async function fetchArchive(
  plan: DownloadPlan,
): Promise<{ ok: true } | { ok: false; reason: DictionaryFailure }> {
  // The metadata has fallen back across sources since the beginning; the bytes
  // never did. Reaching PyPI's API and then failing at its CDN was a dead
  // download with a working mirror sitting one host swap away.
  const urls = downloadUrls(plan.release);
  let last: { ok: false; reason: DictionaryFailure } = { ok: false, reason: "offline" };
  for (const url of urls) {
    const attempt = await fetchArchiveFrom(plan, url);
    if (attempt.ok) return attempt;
    // A cancel is the user's answer, not this source's. Trying the next host
    // would turn one press into a fresh 69 MB from somewhere else.
    if (attempt.reason === "cancelled") return attempt;
    last = attempt;
  }
  return last;
}

async function fetchArchiveFrom(
  plan: DownloadPlan,
  url: string,
): Promise<{ ok: true } | { ok: false; reason: DictionaryFailure }> {
  try {
    const response = await fetch(url, { signal: abort?.signal });
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
    log.info(`dictionary download failed from ${url}`, err);
    return { ok: false, reason: "offline" };
  }
}

/** Startup housekeeping: drop anything an interrupted download left behind. */
export function sweepAbandonedDownloads(dictionaryDir: string): void {
  const removed = nativeSweepPartials(dictionaryDir);
  if (removed > 0) log.info(`removed ${removed} abandoned dictionary download(s)`);
}
