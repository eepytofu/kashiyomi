// Downloads the prebuilt SudachiDict binary into assets/dict/.
// Usage: node tools/fetch-dictionaries.mjs [version] [edition]
//   version: e.g. 20260723, or omit to take whatever `-latest-` resolves to
//   edition: small | core | full (default: core)
//
// core is the default because it is what ships. Measured over 83 Japanese
// fixture lines, core reproduces full's tokens and readings on 94% of them
// (small: 87%), and it is the largest edition that fits a GitHub repo once
// gzipped — 68.8 MB against full's 120.3 MB, over the 100 MB file ceiling.
// The known cost is compound rendaku: full reads 千本桜 センボンザクラ as one
// token, core splits it and gives サクラ.
//
// Arguments are positional but independent: an edition can be given without a
// version. Passing an empty string for the version used to 404, because `??`
// only falls back on null.
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
import { dictionaryFileName } from "../src/engine/dictionaryLayout.ts";

// The vendor's own CloudFront distribution, which is the URL SudachiDict's
// published sdist downloads from. Previously the S3 *website* endpoint, which
// is HTTP-only — this one is HTTPS and serves the same objects, including the
// `-latest-` alias with the same 301.
const BASE = "https://d2ej7fkh96fzlu.cloudfront.net/sudachidict";

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

const EDITIONS = new Set(["small", "core", "full"]);
// Accept the edition in either slot so `fetch-dictionaries.mjs core` works.
// Anything that names an edition is one; everything else is a version.
const positional = process.argv.slice(2).filter((a) => a !== "");
const edition = positional.find((a) => EDITIONS.has(a)) ?? "core";
const pinnedVersion = positional.find((a) => !EDITIONS.has(a));
const dictDir = path.resolve(import.meta.dirname, "..", "assets", "dict");
// The plugin decides at boot which of these to open, so this name has to be
// the one it looks for.
const target = path.join(dictDir, dictionaryFileName(edition));

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

const version = pinnedVersion ?? (await resolveLatest(edition));
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
// The vendor's layout: the name inside the zip happens to match the plugin's
// own. Kept literal so a future divergence breaks here, visibly, rather than
// renaming the wrong file.
await rename(
  path.join(extractDir, `sudachi-dictionary-${version}`, `system_${edition}.dic`),
  target,
);
await rm(extractDir, { recursive: true, force: true });
await rm(zipPath, { force: true });
const final = await stat(target);
console.log(`Done: ${target} (${(final.size / 1e6).toFixed(0)} MB)`);
