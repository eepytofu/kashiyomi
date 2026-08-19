// Fetch a build-pinned dictionary into assets/dict for native CLI development.
// Runtime installs use WinHTTP and do not call this script.

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(path.join(ROOT, "dictionary-releases.json"), "utf8"));
const edition = process.argv[2] ?? "core";
if (edition !== "core" && edition !== "full") throw new Error("edition must be core or full");
const release = manifest.editions[edition];
const directory = path.join(ROOT, "assets", "dict");
const target = path.join(directory, `system_${edition}.dic`);

try {
  if ((await stat(target)).size === release.dictionaryBytes) {
    console.log(`Already present: ${target}`);
    process.exit(0);
  }
} catch {}

await mkdir(directory, { recursive: true });
let installed = false;
for (const [index, source] of release.sources.entries()) {
  const archive = path.join(directory, `.kashiyomi-fetch-${edition}.archive`);
  const extracted = path.join(directory, `.kashiyomi-fetch-${edition}.dic`);
  await rm(archive, { force: true });
  await rm(extracted, { force: true });
  try {
    console.log(`Source ${index + 1}/${release.sources.length}: ${new URL(source.url).host}`);
    const response = await fetch(source.url);
    if (!response.ok || !response.body || !response.url.startsWith("https://")) throw new Error(`HTTP ${response.status}`);
    const archiveHash = createHash("sha256");
    let archiveBytes = 0;
    const archiveMeter = new Transform({ transform(chunk, _encoding, callback) { archiveBytes += chunk.length; archiveHash.update(chunk); callback(null, chunk); } });
    await pipeline(Readable.fromWeb(response.body), archiveMeter, createWriteStream(archive));
    if (archiveBytes !== source.archiveBytes || archiveHash.digest("hex") !== source.archiveSha256) throw new Error("archive verification failed");
    const child = spawn("tar", ["-xOf", archive, source.member], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const dictionaryHash = createHash("sha256");
    let dictionaryBytes = 0;
    const dictionaryMeter = new Transform({ transform(chunk, _encoding, callback) { dictionaryBytes += chunk.length; dictionaryHash.update(chunk); callback(null, chunk); } });
    await pipeline(child.stdout, dictionaryMeter, createWriteStream(extracted));
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    if (code !== 0 || dictionaryBytes !== release.dictionaryBytes || dictionaryHash.digest("hex") !== release.dictionarySha256) throw new Error("dictionary verification failed");
    await rename(extracted, target);
    installed = true;
    break;
  } catch (error) {
    console.warn(`source failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await rm(archive, { force: true });
    await rm(extracted, { force: true });
  }
}
if (!installed) throw new Error(`all pinned ${edition} sources failed`);
console.log(`Done: ${target} (${release.dictionaryBytes} bytes)`);
