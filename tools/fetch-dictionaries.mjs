// Downloads the prebuilt SudachiDict binary into assets/dict/.
// Usage: node tools/fetch-dictionaries.mjs [version] [edition]
//   version: e.g. 20260723, or omit to take whatever `-latest-` resolves to
//   edition: small | core | full (default: full)
//
// SudachiDict ships several releases a year and is the actively maintained
// dictionary here, so a hand-written pin goes stale — this checkout sat on
// 20250515 for five releases. The vendor publishes a `-latest-` alias that
// redirects to the newest build, so there is nothing to keep up to date.
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

const BASE = "http://sudachi.s3-website-ap-northeast-1.amazonaws.com/sudachidict";

/**
 * SudachiDict publishes a `-latest-` alias that 301s to the newest build, so
 * the version never has to be pinned by hand. Resolve it once to learn which
 * release that is, for the log line and the cached zip name.
 */
async function resolveLatest(ed) {
  const alias = `${BASE}/sudachi-dictionary-latest-${ed}.zip`;
  const res = await fetch(alias, { method: "HEAD", redirect: "follow" });
  const found = /sudachi-dictionary-(\d{8})-/.exec(res.url);
  if (!found) throw new Error(`could not resolve ${alias}`);
  return found[1];
}

const edition = process.argv[3] ?? "full";
const dictDir = path.resolve(import.meta.dirname, "..", "assets", "dict");
const target = path.join(dictDir, `system_${edition}.dic`);

// Check for the dictionary before resolving anything: there is no reason to
// touch the network when it is already here, and exiting mid-request leaves an
// open handle that aborts the process on Windows.
try {
  const existing = await stat(target);
  if (existing.size > 0) {
    console.log(`Already present: ${target} (${(existing.size / 1e6).toFixed(0)} MB). Delete it to re-download.`);
    process.exit(0);
  }
} catch {}

const version = process.argv[2] ?? (await resolveLatest(edition));
const url = `${BASE}/sudachi-dictionary-${version}-${edition}.zip`;
const zipPath = path.join(dictDir, `sudachi-dictionary-${version}-${edition}.zip`);

await mkdir(dictDir, { recursive: true });
console.log(`Downloading ${url} ...`);
const res = await fetch(url);
if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
await pipeline(Readable.fromWeb(res.body), createWriteStream(zipPath));
console.log("Extracting ...");
const extractDir = path.join(dictDir, `_extract-${version}-${edition}`);
execFileSync("powershell", [
  "-NoProfile",
  "-Command",
  `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${extractDir}" -Force`,
]);
// Zip layout: sudachi-dictionary-<version>/system_<edition>.dic
await rename(
  path.join(extractDir, `sudachi-dictionary-${version}`, `system_${edition}.dic`),
  target,
);
await rm(extractDir, { recursive: true, force: true });
await rm(zipPath, { force: true });
const final = await stat(target);
console.log(`Done: ${target} (${(final.size / 1e6).toFixed(0)} MB)`);
