// Downloading, verifying and installing the Sudachi dictionary.

import {
  SIMPLE_INDEX_ACCEPT,
  dictionaryMember,
  downloadUrls,
  metadataSources,
  parsePypiRelease,
  parseSimpleIndexRelease,
  requiredFreeBytes,
  type DictionaryFailure,
  type DictionaryEdition,
  type DictionaryRelease,
} from "../engine/dictionarySource.ts";
import {
  archivePath,
  chooseBootEdition,
  dictionaryPath,
  installedEditionsFrom,
} from "../engine/dictionaryLayout.ts";
import type { DictionaryInventory, DictionaryJob } from "../engine/dictionaryState.ts";
import { supersededEdition } from "../engine/dictionaryState.ts";
import { pinnedRelease } from "../engine/dictionaryPins.ts";
import { CHECK_INTERVAL_MS } from "../engine/dictionaryRowState.ts";
import { log } from "./log.ts";
import { getSettings, updateSettings } from "./settings.ts";
import {
  nativeCancelInstall,
  nativeDictStatus,
  nativeFreeSpace,
  nativeInit,
  nativeStartInstall,
  nativeSweepPartials,
} from "./native.ts";

let inventory: DictionaryInventory = {
  installed: false,
  edition: undefined,
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

/** How many things are currently following the dictionary. */
export function dictionaryListenerCount(): number {
  return listeners.size;
}

/** Notify a listener whenever either changes, whoever changed it. */
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

/** The shortest gap between two progress announcements. */
const PROGRESS_ANNOUNCE_MS = 250;
let lastProgressAnnounce = 0;

/** Record progress every chunk, tell anyone about it far less often. */
function setProgress(next: DictionaryJob): void {
  job = next;
  const now = Date.now();
  if (now - lastProgressAnnounce < PROGRESS_ANNOUNCE_MS) return;
  lastProgressAnnounce = now;
  announce();
}

/** Publish what the disk holds. */
export function reportInventory(edition: DictionaryEdition | undefined): void {
  const settings = getSettings();
  if (edition === undefined && settings.dictVersion !== undefined) {
    updateSettings({ dictVersion: undefined });
  } else if (edition !== undefined && settings.dictEdition !== edition) {
    // A manually placed file or a fallback after manual deletion has no known
    // release. Record what will actually be opened without borrowing the old
    // edition's version string.
    updateSettings({ dictEdition: edition, dictVersion: undefined });
  }
  // `latest` survives a disk re-read: it records what a *check* found, which a
  // directory listing knows nothing about.
  inventory = {
    installed: edition !== undefined,
    edition,
    version: edition !== undefined ? getSettings().dictVersion : undefined,
    latest: inventory.latest,
    // Read from settings rather than carried, so a boot picks up a check made
    // in an earlier session and the throttle survives an NCM restart.
    checkedAt: getSettings().dictCheckedAt,
  };
  announce();
}

/** Whether the dictionary is on disk, asked of the disk. */
export async function dictionaryEditionOnDisk(
  dictDir: string,
  active: DictionaryEdition = getSettings().dictEdition,
): Promise<DictionaryEdition | undefined> {
  try {
    return chooseBootEdition(active, installedEditionsFrom(await betterncm.fs.readDir(dictDir)));
  } catch {
    // A missing data directory on a fresh install is the normal path here, not
    // an error: nothing is installed, which is what `false` says.
    return undefined;
  }
}

/** Re-read the directory and publish what is actually there. */
async function refreshInventory(dictDir: string, active: DictionaryEdition): Promise<void> {
  reportInventory(await dictionaryEditionOnDisk(dictDir, active));
}

/** Whether a check ran recently enough that another one cannot learn anything. */
export function checkedRecently(): boolean {
  const at = getSettings().dictCheckedAt;
  return at !== undefined && Date.now() - at < CHECK_INTERVAL_MS;
}

/** Record that a check got a real answer. */
export function recordCheck(): void {
  const at = Date.now();
  updateSettings({ dictCheckedAt: at });
  inventory = { ...inventory, checkedAt: at };
}

/** Check for a newer release without anyone pressing anything. */
export async function checkForNewerRelease(): Promise<void> {
  if (inFlight || job.kind !== "idle" || checkedRecently()) return;
  const edition = inventory.edition ?? getSettings().dictEdition;
  const { release, checked } = await resolveRelease(edition);
  if (checked) {
    inventory = { ...inventory, latest: release.version };
    recordCheck();
  }
  if (dictionaryJob().kind === "resolving") setJob({ kind: "idle" });
  else announce();
}

/** Forget the last check, so the next open asks again. */
export function forgetDictionaryCheck(): void {
  updateSettings({ dictCheckedAt: undefined });
  inventory = { ...inventory, checkedAt: undefined, latest: undefined };
  announce();
}

/**
 * The update check itself failed, with the dictionary already at the pinned
 * version so there is nothing to install instead.
 */
export function reportNoSource(): void {
  setJob({ kind: "failed", reason: "no-source", at: Date.now() });
}

/** A check answered, and the installed dictionary is already that release. */
export function reportUpToDate(): void {
  recordCheck();
  setJob({ kind: "idle" });
}

/** Stop whatever the current attempt is doing, wherever it has got to. */
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
  /** False when every metadata source refused and this is the build-time pin. */
  readonly checked: boolean;
};

/** Resolve the newest release, trying each source in turn. */
export async function resolveRelease(edition: DictionaryEdition): Promise<ResolvedRelease> {
  // The attempt's abort signal starts here, not at the download: an update
  // check against a source that is timing out is exactly when someone reaches
  // for Cancel, and there was nothing to press it against.
  abort = new AbortController();
  setJob({ kind: "resolving", at: Date.now() });

  const sources = metadataSources(edition);
  // Full is updated with Kashiyomi's reviewed build pin. This avoids learning
  // an install hash from a runtime source while still making a newer plugin
  // release immediately able to update an older Full dictionary.
  if (sources.length === 0) {
    setJob({ kind: "idle" });
    return { release: pinnedRelease(edition), checked: true };
  }

  for (const source of sources) {
    try {
      const response = await fetch(source.url, {
        headers: source.kind === "simple" ? { accept: SIMPLE_INDEX_ACCEPT } : {},
        signal: abort.signal,
      });
      if (!response.ok) continue;
      const body: unknown = await response.json();
      const release =
        source.kind === "simple"
          ? parseSimpleIndexRelease(edition, body)
          : parsePypiRelease(edition, body);
      if (release) return { release, checked: true };
    } catch (err) {
      // A cancel must end the whole attempt, not advance to the next source.
      // Falling through would have Cancel walk the list one press at a time.
      if (err instanceof Error && err.name === "AbortError") {
        fail("cancelled");
        return { release: pinnedRelease(edition), checked: false };
      }
      log.debug(`dictionary metadata source failed: ${source.url}`, err);
    }
  }
  // Every source refused. The pinned release is still installable, because the
  // pin carries its own URL, so a blocked upstream no longer means no
  // dictionary at all.
  setJob({ kind: "idle" });
  return { release: pinnedRelease(edition), checked: false };
}

export type DownloadPlan = {
  readonly release: DictionaryRelease;
  /** Where the archive is staged; beside the target so the rename is atomic. */
  readonly archivePath: string;
  readonly targetPath: string;
  /** The directory both live in, so callers stop slicing it back out of a path. */
  readonly directory: string;
  /** Active dictionary removed by native code only after this one loads. */
  readonly supersededPath: string | undefined;
};

export function planDownload(
  release: DictionaryRelease,
  dictionaryDir: string,
  active: DictionaryEdition | undefined,
): DownloadPlan {
  return {
    release,
    archivePath: archivePath(dictionaryDir, release.edition, release.version),
    targetPath: dictionaryPath(dictionaryDir, release.edition),
    directory: dictionaryDir,
    supersededPath: (() => {
      const superseded = supersededEdition(active, release.edition);
      return superseded === undefined ? undefined : dictionaryPath(dictionaryDir, superseded);
    })(),
  };
}

/** Fetch, verify, install, and load, in that order and never any other. */
export async function downloadDictionary(
  plan: DownloadPlan,
  resourceDir: string,
): Promise<DictionaryJob> {
  if (inFlight) return job;
  inFlight = true;
  // Reuse the controller `resolveRelease` opened for this attempt rather than
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
      dictionaryMember(plan.release.edition),
      plan.targetPath,
      resourceDir,
      plan.supersededPath,
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
      if (installed.cancelled) return fail("cancelled");
      log.info(`dictionary install failed: ${installed.error}`);
      return fail(/checksum/u.test(installed.error) ? "checksum" : "extract");
    }

    if (!installed.started) return fail("load");
    const loaded = await awaitAnalyzer();
    if (!loaded) {
      // A switch unloads the active edition before opening the replacement.
      // Native deliberately keeps the old file until the new one succeeds; put
      // that file back in service now, not only after the next NCM restart.
      if (plan.supersededPath !== undefined) {
        nativeInit(plan.supersededPath, resourceDir);
        await awaitAnalyzer();
      }
      return fail("load");
    }
    // Commit settings only once the replacement is actually serving analysis.
    // Until this point the old edition remains the authoritative working copy.
    updateSettings({
      dictEdition: plan.release.edition,
      dictVersion: plan.release.version,
    });
    await refreshInventory(plan.directory, plan.release.edition);
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

/** Follow the worker to its end, republishing each phase as it goes. */
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

/** Wait for the background Sudachi load that follows the native file swap. */
async function awaitAnalyzer(): Promise<boolean> {
  for (;;) {
    const status = nativeDictStatus();
    if (!status) return false;
    if (status.analyzer.state === "ready") return true;
    if (status.analyzer.state === "failed" || status.analyzer.state === "unavailable") {
      return false;
    }
    setProgress({ kind: "installing", phase: "loading", done: 0, total: 0 });
    await new Promise((resolve) => window.setTimeout(resolve, INSTALL_POLL_MS));
  }
}

/** Stream the archive to disk, updating progress as it goes. */
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
