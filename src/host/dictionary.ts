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
  metadataSources,
  parsePypiRelease,
  parseSimpleIndexRelease,
  requiredFreeBytes,
  type DictionaryEdition,
  type DictionaryFailure,
  type DictionaryRelease,
  type DictionaryStatus,
} from "../engine/dictionarySource.ts";
import { log } from "./log.ts";
import {
  nativeFreeSpace,
  nativeInstallDictionary,
  nativeReload,
  nativeSweepPartials,
} from "./native.ts";

let status: DictionaryStatus = { kind: "absent" };
let inFlight = false;
let abort: AbortController | undefined;

export function dictionaryStatus(): DictionaryStatus {
  return status;
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
  return undefined;
}

export type DownloadPlan = {
  readonly release: DictionaryRelease;
  /** Where the archive is staged; beside the target so the rename is atomic. */
  readonly archivePath: string;
  readonly targetPath: string;
  /** Path inside the wheel. */
  readonly member: string;
};

export function planDownload(
  release: DictionaryRelease,
  dictionaryDir: string,
): DownloadPlan {
  return {
    release,
    archivePath: `${dictionaryDir}/sudachidict_${release.edition}-${release.version}.whl`,
    targetPath: `${dictionaryDir}/system_${release.edition}.dic`,
    member: `sudachidict_${release.edition}/resources/system.dic`,
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
): Promise<DictionaryStatus> {
  if (inFlight) return status;
  inFlight = true;
  abort = new AbortController();
  try {
    if (simulated) return fail(simulated);
    // Before the bandwidth, not after: the archive and its 207 MB extraction
    // exist at once, and a disk that cannot hold both should say so now.
    const dir = plan.targetPath.slice(0, plan.targetPath.lastIndexOf("/"));
    const free = nativeFreeSpace(dir);
    if (free !== undefined && free < requiredFreeBytes(plan.release.size)) {
      log.info(
        `dictionary needs ${requiredFreeBytes(plan.release.size)} bytes free, ${free} available`,
      );
      return fail("disk-space");
    }

    status = { kind: "downloading", received: 0, total: plan.release.size };
    const archive = await fetchArchive(plan);
    if (!archive.ok) return fail(archive.reason);

    status = { kind: "installing" };
    const installed = nativeInstallDictionary(
      plan.archivePath,
      plan.release.sha256,
      plan.member,
      plan.targetPath,
    );
    if (!installed.ok) {
      // The backend already discarded the archive and any staging; the message
      // distinguishes a corrupt download from a full disk.
      log.info(`dictionary install failed: ${installed.error}`);
      return fail(/checksum/u.test(installed.error) ? "checksum" : "extract");
    }

    if (!nativeReload(plan.targetPath, resourceDir)) return fail("load");
    status = {
      kind: "installed",
      edition: plan.release.edition,
      version: plan.release.version,
    };
    return status;
  } finally {
    inFlight = false;
    abort = undefined;
  }
}

function fail(reason: DictionaryFailure): DictionaryStatus {
  status = { kind: "failed", reason };
  return status;
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
      status = { kind: "downloading", received, total: plan.release.size };
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
