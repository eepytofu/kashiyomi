// Exports the complete pinyin dictionary to assets/pinyin/complete.json so
// the plugin can load it from disk at runtime instead of bundling ~10MB.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import CompleteDict from "@pinyin-pro/data/complete";

const outDir = path.resolve(import.meta.dirname, "..", "assets", "pinyin");
await mkdir(outDir, { recursive: true });
const outFile = path.join(outDir, "complete.json");
const json = JSON.stringify(CompleteDict);
await writeFile(outFile, json);
console.log(`Wrote ${outFile} (${(json.length / 1e6).toFixed(1)} MB)`);
