// Downloads the prebuilt SudachiDict binary into assets/dict/.
// Usage: node tools/fetch-dictionaries.mjs [version] [edition]
//   version: e.g. 20260723, or omit to resolve the newest release
//   edition: small | core | full (default: full)
//
// The S3 bucket has no "latest" alias, so the newest version is resolved from
// the SudachiDict repo's tags. SudachiDict ships several releases a year and is
// the actively maintained dictionary here, so pinning by hand goes stale: this
// checkout sat on 20250515 for five releases.
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

/** Newest release tag, e.g. "20260723". Falls back to a known-good pin. */
async function latestVersion() {
  const FALLBACK = "20260723";
  try {
    const res = await fetch("https://api.github.com/repos/WorksApplications/SudachiDict/tags?per_page=20", {
      headers: { "User-Agent": "kashiyomi" },
    });
    if (!res.ok) return FALLBACK;
    const tags = await res.json();
    const versions = tags
      .map((t) => /^v?(\d{8})$/.exec(t.name)?.[1])
      .filter((v) => v !== undefined)
      .sort();
    return versions[versions.length - 1] ?? FALLBACK;
  } catch {
    // Offline or rate limited; the pin is still a real release.
    return FALLBACK;
  }
}

const version = process.argv[2] ?? (await latestVersion());
const edition = process.argv[3] ?? "full";
const url = `http://sudachi.s3-website-ap-northeast-1.amazonaws.com/sudachidict/sudachi-dictionary-${version}-${edition}.zip`;

const dictDir = path.resolve(import.meta.dirname, "..", "assets", "dict");
const target = path.join(dictDir, `system_${edition}.dic`);
const zipPath = path.join(dictDir, `sudachi-dictionary-${version}-${edition}.zip`);

try {
  const existing = await stat(target);
  if (existing.size > 0) {
    console.log(`Already present: ${target} (${(existing.size / 1e6).toFixed(0)} MB). Delete it to re-download.`);
    process.exit(0);
  }
} catch {}

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
