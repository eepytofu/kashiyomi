// Downloading, verifying and installing the Sudachi dictionary.
//
// Splits the work where each side is strong: `fetch` here, because it is
// already HTTPS, already streams, and already honours whatever proxy the user
// has configured, all of which a Rust client would need written by hand, and
// the users who most need a proxy are exactly the ones this exists for.
// Verification and extraction happen natively, because the extracted dictionary
// is 207 MB and has no business in this heap.
//
// Policy lives in `engine/dictionarySource.ts`: which source to try, what each
// failure means, whether it fits the disk. That half is covered by
// `node --test` without a network.

import {
  DICTIONARY_MEMBER,
  SIMPLE_INDEX_ACCEPT,
  downloadUrls,
  metadataSources,
  parsePypiRelease,
  parseSimpleIndexRelease,
  requiredFreeBytes,
  type DictionaryFailure,
  type DictionaryRelease,
} from "../engine/dictionarySource.ts";
import { archivePath, dictionaryPath, hasDictionary } from "../engine/dictionaryLayout.ts";
import type { DictionaryInventory, DictionaryJob } from "../engine/dictionaryState.ts";
import { pinnedRelease } from "../engine/dictionaryPins.ts";
import { CHECK_INTERVAL_MS } from "../engine/dictionaryRowState.ts";
import { log } from "./log.ts";
import { getSettings, updateSettings } from "./settings.ts";
import {
  nativeCancelInstall,
  nativeDictStatus,
  nativeFreeSpace,
  nativeStartInstall,
  nativeSweepPartials,
} from "./native.ts";

let inventory: DictionaryInventory = {
  installed: false,
  version: undefined,
  latest: undefined,
  checkedAt: undefined,
};
let job: DictionaryJob = { kind: "idle" };
let inFlight = false;
let abort: AbortController | undefined;
const listeners = new Set<() => void>();

/** What is on disk and whether the analyzer opened it. */
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
 * dictionary. The first-run dialog adds a third while it is open. What matters
 * is that the count returns to its baseline after a rebuild or a close, not
 * that it equals any particular figure, so read it twice rather than once.
 */
export function dictionaryListenerCount(): number {
  return listeners.size;
}

/**
 * Notify a listener whenever either changes, whoever changed it.
 *
 * The settings row used to repaint only in response to its own button, so a
 * download started anywhere else left it reading "not installed" over a
 * dictionary that was installed and working. A control whose whole job is
 * reporting state has to follow the state rather than its own last click.
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
 * A `ReadableStream` over a 69 MB transfer hands back roughly a thousand
 * chunks, and every one of them used to notify every listener, each repainting
 * a row whose smallest visible step is 0.1 MB. Nothing could see most of that
 * work. At 250 ms the bar still moves continuously to a human and the panel
 * repaints a few dozen times instead of a thousand.
 */
const PROGRESS_ANNOUNCE_MS = 250;
let lastProgressAnnounce = 0;

/**
 * Record progress every chunk, tell anyone about it far less often.
 *
 * The value stays current because the control also samples it on a timer, so
 * this is a coalesced *notification*, never a coalesced measurement: a reader
 * arriving between announcements still sees the true byte count.
 */
function setProgress(next: DictionaryJob): void {
  job = next;
  const now = Date.now();
  if (now - lastProgressAnnounce < PROGRESS_ANNOUNCE_MS) return;
  lastProgressAnnounce = now;
  announce();
}

/**
 * Publish what the disk holds.
 *
 * Takes the answer rather than reading it, because boot has already asked the
 * directory and reading it twice invites the two answers to differ. The
 * recorded version is dropped when the file is not there: a version describes a
 * file, and outliving it would let the control date something nothing can open.
 */
export function reportInventory(installed: boolean): void {
  if (!installed && getSettings().dictVersion !== undefined) {
    updateSettings({ dictVersion: undefined });
  }
  // `latest` survives a disk re-read: it records what a *check* found, which a
  // directory listing knows nothing about.
  inventory = {
    installed,
    version: installed ? getSettings().dictVersion : undefined,
    latest: inventory.latest,
    // Read from settings rather than carried, so a boot picks up a check made
    // in an earlier session and the throttle survives an NCM restart.
    checkedAt: getSettings().dictCheckedAt,
  };
  announce();
}

/** Whether the dictionary is on disk, asked of the disk. */
export async function dictionaryOnDisk(dictDir: string): Promise<boolean> {
  try {
    return hasDictionary(await betterncm.fs.readDir(dictDir));
  } catch {
    // A missing data directory on a fresh install is the normal path here, not
    // an error: nothing is installed, which is what `false` says.
    return false;
  }
}

/** Re-read the directory and publish what is actually there. */
async function refreshInventory(dictDir: string): Promise<void> {
  reportInventory(await dictionaryOnDisk(dictDir));
}

/**
 * Whether a check ran recently enough that another one cannot learn anything.
 *
 * The interval lives in the engine beside the view that reads it, so the rule
 * the button is disabled by and the rule the network request is skipped by are
 * the same number rather than two that can drift.
 */
export function checkedRecently(): boolean {
  const at = getSettings().dictCheckedAt;
  return at !== undefined && Date.now() - at < CHECK_INTERVAL_MS;
}

/**
 * Record that a check got a real answer.
 *
 * Written on any answered check, including one that found nothing: "nothing
 * newer exists" is exactly the answer worth remembering, since it is the one
 * that makes asking again pointless for a while.
 */
export function recordCheck(): void {
  const at = Date.now();
  updateSettings({ dictCheckedAt: at });
  inventory = { ...inventory, checkedAt: at };
}

/**
 * Check for a newer release without anyone pressing anything.
 *
 * Refuses while anything else is happening, so it can never interrupt an
 * install or steal its abort signal, and it clears its own resolving state
 * afterwards so a background check does not leave the button reading
 * "Checking…" forever.
 *
 * Also refuses inside the interval. Opening settings used to fire two requests
 * every time, which for a dictionary that ships quarterly is a network call to
 * re-learn what is already on disk.
 *
 * A failure records nothing. `latest` staying undefined means "not asked",
 * which is exactly why it can never be mistaken for "up to date": a control
 * asserting a check it had never made is what this exists to end.
 */
export async function checkForNewerRelease(): Promise<void> {
  if (inFlight || job.kind !== "idle" || checkedRecently()) return;
  const { release, checked } = await resolveRelease();
  if (checked) {
    inventory = { ...inventory, latest: release.version };
    recordCheck();
  }
  if (dictionaryJob().kind === "resolving") setJob({ kind: "idle" });
  else announce();
}

/**
 * Forget the last check, so the next open asks again.
 *
 * Debug only, on `kashiyomi.forgetDictCheck`. A twelve-hour throttle that
 * persists across restarts is otherwise untestable without hand-editing
 * settings, which is how a test ends up proving something about a blob rather
 * than about the code.
 */
export function forgetDictionaryCheck(): void {
  updateSettings({ dictCheckedAt: undefined });
  inventory = { ...inventory, checkedAt: undefined, latest: undefined };
  announce();
}

/**
 * The update check itself failed, with the dictionary already at the pinned
 * version so there is nothing to install instead.
 *
 * The only place `no-source` is set. It used to be declared and unreachable,
 * which meant the control could never say the difference between "nothing
 * newer exists" and "nobody answered".
 */
export function reportNoSource(): void {
  setJob({ kind: "failed", reason: "no-source", at: Date.now() });
}

/**
 * Stop whatever the current attempt is doing, wherever it has got to.
 *
 * Two mechanisms because there are two kinds of work and one signal cannot
 * reach both: the metadata check and the transfer are `fetch` calls behind an
 * `AbortController`, while verifying and unpacking happen on a native worker
 * that only sees a flag it polls between chunks.
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
 * sensibly. Wired to `kashiyomi.simulateDictFailure`: unit tests can prove the
 * state machine but cannot judge wording, and wording is what a user meets.
 */
let simulated: DictionaryFailure | undefined;
export function simulateDictionaryFailure(reason: DictionaryFailure | undefined): void {
  simulated = reason;
}

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

/**
 * Resolve the newest release, trying each source in turn.
 *
 * Falls through on **failure**, never on a guess about where the user is: a
 * mainland connection reaches the mirror naturally and everyone else never
 * learns it exists.
 */
export async function resolveRelease(): Promise<ResolvedRelease> {
  // The attempt's abort signal starts here, not at the download: an update
  // check against a source that is timing out is exactly when someone reaches
  // for Cancel, and there was nothing to press it against.
  abort = new AbortController();
  setJob({ kind: "resolving" });

  for (const source of metadataSources()) {
    try {
      const response = await fetch(source.url, {
        headers: source.kind === "simple" ? { accept: SIMPLE_INDEX_ACCEPT } : {},
        signal: abort.signal,
      });
      if (!response.ok) continue;
      const body: unknown = await response.json();
      const release =
        source.kind === "simple" ? parseSimpleIndexRelease(body) : parsePypiRelease(body);
      if (release) return { release, checked: true };
    } catch (err) {
      // A cancel must end the whole attempt, not advance to the next source.
      // Falling through would have Cancel walk the list one press at a time.
      if (err instanceof Error && err.name === "AbortError") {
        fail("cancelled");
        return { release: pinnedRelease(), checked: false };
      }
      log.debug(`dictionary metadata source failed: ${source.url}`, err);
    }
  }
  // Every source refused. The pinned release is still installable, because the
  // pin carries its own URL, so a blocked upstream no longer means no
  // dictionary at all.
  setJob({ kind: "idle" });
  return { release: pinnedRelease(), checked: false };
}

export type DownloadPlan = {
  readonly release: DictionaryRelease;
  /** Where the archive is staged; beside the target so the rename is atomic. */
  readonly archivePath: string;
  readonly targetPath: string;
  /** The directory both live in, so callers stop slicing it back out of a path. */
  readonly directory: string;
};

export function planDownload(release: DictionaryRelease, dictionaryDir: string): DownloadPlan {
  return {
    release,
    archivePath: archivePath(dictionaryDir, release.version),
    targetPath: dictionaryPath(dictionaryDir),
    directory: dictionaryDir,
  };
}

/**
 * Fetch, verify, install, and load, in that order and never any other.
 *
 * The dictionary is only replaced by a rename of a file that has already been
 * hash-checked and extracted, so a failure at any step leaves the working one
 * in place. Nothing here writes to the live path.
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
  try {
    if (simulated) return fail(simulated);
    // Before the bandwidth, not after: the archive and its 207 MB extraction
    // exist at once, and a disk that cannot hold both should say so now.
    const dir = plan.directory;
    const free = nativeFreeSpace(dir);
    if (free !== undefined && free < requiredFreeBytes(plan.release.size)) {
      log.info(
        `dictionary needs ${requiredFreeBytes(plan.release.size)} bytes free, ${free} available`,
      );
      return fail("disk-space");
    }

    // The data directory does not exist on a fresh install, and writeFile does
    // not create it: the first real run failed here with "cannot find the path
    // specified" after downloading the whole archive.
    try {
      await betterncm.fs.mkdir(dir);
    } catch (err) {
      log.debug("could not create the dictionary directory", err);
    }

    setJob({ kind: "downloading", received: 0, total: plan.release.size });
    const archive = await fetchArchive(plan);
    if (!archive.ok) return fail(archive.reason);

    setJob({ kind: "installing", phase: "verifying", done: 0, total: 0 });
    const started = nativeStartInstall(
      plan.archivePath,
      plan.release.sha256,
      DICTIONARY_MEMBER,
      plan.targetPath,
      resourceDir,
    );
    if (!started.ok) {
      log.info(`dictionary install failed: ${started.error}`);
      return fail("extract");
    }
    if (!started.started) {
      // A worker is already installing. Refusing is the guard against two
      // threads renaming onto the same target, so this is not an error.
      log.info("an install is already running");
      return job;
    }

    const installed = await awaitInstall();
    if (!installed.ok) {
      // The backend already discarded the archive and any staging. Cancelling
      // is reported as its own outcome by the worker rather than inferred from
      // a message, so a genuine failure that happens to mention the word cannot
      // be mistaken for one the user asked for.
      if (installed.cancelled) return fail("cancelled");
      log.info(`dictionary install failed: ${installed.error}`);
      return fail(/checksum/u.test(installed.error) ? "checksum" : "extract");
    }

    // Recorded before the load is judged, not after. The bytes are verified and
    // in place by this point, so forgetting the version because a load was
    // momentarily busy used to cost another 69 MB to learn a date string
    // already on the disk.
    updateSettings({ dictVersion: plan.release.version });
    await refreshInventory(plan.directory);
    // `started` is the analyzer's answer about this install, and it is still
    // acted on — it just is not stored, because a boolean captured once goes
    // stale the moment the background load finishes.
    if (!installed.started) return fail("load");
    return setJob({ kind: "idle" });
  } finally {
    inFlight = false;
    abort = undefined;
  }
}

function fail(reason: DictionaryFailure): DictionaryJob {
  return setJob({ kind: "failed", reason, at: Date.now() });
}

/** How often the worker thread is asked how it is getting on. */
const INSTALL_POLL_MS = 150;

type InstallOutcome =
  | { ok: true; started: boolean }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled?: false; error: string };

/**
 * Follow the worker to its end, republishing each phase as it goes.
 *
 * Progress is coalesced the same way the download is: the phase and byte count
 * are recorded every poll, but listeners hear about it on the slower cadence,
 * because a 207 MB extract at 150 ms is still far more repaints than a control
 * measured in tenths of a megabyte can show.
 */
async function awaitInstall(): Promise<InstallOutcome> {
  for (;;) {
    await new Promise((resolve) => window.setTimeout(resolve, INSTALL_POLL_MS));
    const status = nativeDictStatus();
    if (!status) return { ok: false, error: "the analyzer backend is unavailable" };
    const native = status.job;
    if (native.kind === "running") {
      setProgress({
        kind: "installing",
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
 * can move while a 69 MB transfer is in flight: a progress bar that only moves
 * at the end is worse than none.
 */
async function fetchArchive(
  plan: DownloadPlan,
): Promise<{ ok: true } | { ok: false; reason: DictionaryFailure }> {
  // The metadata has fallen back across sources since the beginning; the bytes
  // never did. Reaching PyPI's API and then failing at its CDN was a dead
  // download with a working mirror sitting one host swap away.
  let last: { ok: false; reason: DictionaryFailure } = { ok: false, reason: "offline" };
  for (const url of downloadUrls(plan.release)) {
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
      setProgress({ kind: "downloading", received, total: plan.release.size });
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
