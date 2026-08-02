// Downloads the prebuilt SudachiDict binary into assets/dict/.
// Usage: node tools/fetch-dictionaries.mjs [version] [edition]
//   version: e.g. 20250515 (default)
//   edition: small | core | full (default: full)
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

const version = process.argv[2] ?? "20250515";
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
