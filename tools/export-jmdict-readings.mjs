// Builds assets/jmdict/readings.json: kanji surface -> its single JMdict reading.
// Usage: node tools/export-jmdict-readings.mjs [--force]
//
// Analyzer lexicons hold one reading per entry, chosen to make parsing work.
// JMdict holds every reading a surface has. Only the surfaces where it holds
// **exactly one** are exported, because those are the ones where supplying a
// reading is not a choice between candidates. `src/engine/jmdictReadings.ts`
// carries the safety argument and the measurements behind it.
//
// jmdict-simplified rebuilds daily and stamps the date into the release tag, so
// like SudachiDict this resolves the newest release rather than pinning one.
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

const RELEASES = "https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest";
const outDir = path.resolve(import.meta.dirname, "..", "assets", "jmdict");
const outFile = path.join(outDir, "readings.json");

if (!process.argv.includes("--force")) {
  try {
    const existing = await stat(outFile);
    if (existing.size > 0) {
      console.log(`Already present: ${outFile} (${(existing.size / 1e6).toFixed(1)} MB). Pass --force to rebuild.`);
      process.exit(0);
    }
  } catch {}
}

const release = await (await fetch(RELEASES, {
  headers: { accept: "application/vnd.github+json" },
})).json();
// The English build carries the same entry set as jmdict-all at a third the
// size; only the glosses differ, and no gloss is read here. `-common-` is a
// different thing — a subset of common words — so the pattern excludes it.
const asset = release.assets.find((a) => /^jmdict-eng-\d.*\.json\.zip$/.test(a.name));
if (!asset) throw new Error("no jmdict-eng json.zip in the latest release");
console.log(`Resolved ${release.tag_name} -> ${asset.name}`);

await mkdir(outDir, { recursive: true });
const zipPath = path.join(outDir, "_jmdict.zip");
const extractDir = path.join(outDir, "_extract");
const res = await fetch(asset.browser_download_url);
if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
await pipeline(Readable.fromWeb(res.body), createWriteStream(zipPath));

execFileSync("powershell", [
  "-NoProfile",
  "-Command",
  `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${extractDir}" -Force`,
]);
const inner = execFileSync("powershell", [
  "-NoProfile",
  "-Command",
  `(Get-ChildItem -LiteralPath "${extractDir}" -Filter *.json | Select-Object -First 1).FullName`,
]).toString().trim();

const { words } = JSON.parse(await readFile(inner, "utf8"));

const HAN = /[㐀-鿿豈-﫿]|[\ud840-\ud87f][\udc00-\udfff]/u;
const surfaces = new Map();
for (const word of words) {
  // sK and sk mark search-only forms and ok marks outdated kana: none of the
  // three is a reading anyone should see rendered over a lyric.
  const kanji = word.kanji.filter((k) => !k.tags.includes("sK"));
  const kana = word.kana.filter((k) => !k.tags.includes("sk") && !k.tags.includes("ok"));
  for (const kj of kanji) {
    if (!HAN.test(kj.text)) continue;
    for (const kn of kana) {
      // A reading can apply to only some of an entry's kanji forms: entry
      // 1000110 pairs ＣＤプレーヤー with シーディープレーヤー and
      // ＣＤプレイヤー with シーディープレイヤー. Ignoring this cross-pairs them.
      if (!(kn.appliesToKanji.includes("*") || kn.appliesToKanji.includes(kj.text))) continue;
      if (!surfaces.has(kj.text)) surfaces.set(kj.text, new Set());
      surfaces.get(kj.text).add(kn.text);
    }
  }
}

const single = {};
let ambiguous = 0;
for (const [surface, readings] of surfaces) {
  if (readings.size === 1) single[surface] = [...readings][0];
  else ambiguous++;
}

const json = JSON.stringify(single);
await writeFile(outFile, json);
await rm(zipPath, { force: true });
await rm(extractDir, { recursive: true, force: true });
console.log(`Surfaces with kanji : ${surfaces.size}`);
console.log(`Exactly one reading : ${Object.keys(single).length}`);
console.log(`Left to the analyzer: ${ambiguous} (several readings; not ours to choose)`);
console.log(`Wrote ${outFile} (${(json.length / 1e6).toFixed(1)} MB)`);
