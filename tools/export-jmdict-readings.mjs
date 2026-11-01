// Builds assets/jmdict/readings.json: kanji surface -> its single JMdict reading.
// Usage: node tools/export-jmdict-readings.mjs [--force] [--tag <release tag>]
//
// Analyzer lexicons hold one reading per entry, chosen to make parsing work.
// JMdict holds every reading a surface has. Only the surfaces where it holds
// **exactly one** are exported, because those are the ones where supplying a
// reading is not a choice between candidates. `src/engine/jmdictReadings.ts`
// carries the safety argument and the measurements behind it.
//
// jmdict-simplified rebuilds daily and stamps the date into the release tag.
// The export is pinned to JMDICT_TAG so the same checkout builds the same
// readings; move the pin deliberately (`--tag` tries another release first).
import { mkdir, readFile, rm, stat, writeFile, readdir } from "node:fs/promises";
import { createWriteStream, existsSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

const JMDICT_TAG = "3.6.2+20261026175559";
const tagArg = process.argv.indexOf("--tag");
const tag = tagArg >= 0 ? process.argv[tagArg + 1] : JMDICT_TAG;
if (!tag) throw new Error("--tag needs a release tag");
const RELEASES = `https://api.github.com/repos/scriptin/jmdict-simplified/releases/tags/${encodeURIComponent(tag)}`;
const outDir = path.resolve(import.meta.dirname, "..", "assets", "jmdict");
const outFile = path.join(outDir, "readings.json");

/** Windows: prefer System32 bsdtar (reads zip); Git Bash PATH may put GNU tar first. */
function tarBin() {
  if (process.platform === "win32") {
    const sys = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
    if (existsSync(sys)) return sys;
  }
  return "tar";
}

if (!process.argv.includes("--force")) {
  try {
    const existing = await stat(outFile);
    if (existing.size > 0) {
      console.log(`Already present: ${outFile} (${(existing.size / 1e6).toFixed(1)} MB). Pass --force to rebuild.`);
      process.exit(0);
    }
  } catch {}
}

const releaseRes = await fetch(RELEASES, {
  headers: {
    accept: "application/vnd.github+json",
    "user-agent": "kashiyomi-export-jmdict",
    ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
  },
});
if (!releaseRes.ok) throw new Error(`Release ${tag} not found: HTTP ${releaseRes.status}`);
const release = await releaseRes.json();
// The English build carries the same entry set as jmdict-all at a third the
// size; only the glosses differ, and no gloss is read here. `-common-` is a
// different thing — a subset of common words — so the pattern excludes it.
const asset = release.assets.find((a) => /^jmdict-eng-\d.*\.json\.zip$/.test(a.name));
if (!asset) throw new Error(`no jmdict-eng json.zip in release ${tag}`);
console.log(`Resolved ${release.tag_name} -> ${asset.name}`);

await mkdir(outDir, { recursive: true });
const zipPath = path.join(outDir, "_jmdict.zip");
const extractDir = path.join(outDir, "_extract");
const res = await fetch(asset.browser_download_url);
if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
await pipeline(Readable.fromWeb(res.body), createWriteStream(zipPath));

await rm(extractDir, { recursive: true, force: true });
await mkdir(extractDir, { recursive: true });
execFileSync(tarBin(), ["-xf", zipPath, "-C", extractDir]);
const jsonName = (await readdir(extractDir, { recursive: true })).find(
  (f) => typeof f === "string" && f.endsWith(".json"),
);
if (!jsonName) throw new Error(`no .json in extracted ${asset.name}`);
const inner = path.join(extractDir, jsonName);

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
