// Installs the plugin into the local BetterNCM plugins_runtime folder for
// testing. Large assets (Sudachi dictionary, pinyin JSON) stay in this
// checkout; a generated dev-paths.json points the plugin at them.
import { cp, mkdir, rm, writeFile, access } from "node:fs/promises";
import path from "node:path";

const repo = path.resolve(import.meta.dirname, "..");
// plugins_dev is BetterNCM's folder for unpacked development plugins; it is
// loaded directly and survives restarts (plugins_runtime gets rebuilt).
const target = process.argv[2] ?? "C:/betterncm/plugins_dev/Kashiyomi";

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

const dll = path.join(repo, "native", "target", "release", "kashiyomi_backend.dll");
const bundle = path.join(repo, "dist", "main.js");
for (const [file, hint] of [
  [dll, "cd native && cargo build --release"],
  [bundle, "npm run build"],
]) {
  if (!(await exists(file))) {
    console.error(`Missing ${file}. Run: ${hint}`);
    process.exit(1);
  }
}

let dllSkipped = false;
try {
  await rm(target, { recursive: true, force: true });
} catch {
  // backend.dll stays locked while NCM is running; replace what we can.
}
await mkdir(target, { recursive: true });
await cp(path.join(repo, "manifest.json"), path.join(target, "manifest.json"));
await cp(bundle, path.join(target, "main.js"));
try {
  await cp(dll, path.join(target, "backend.dll"));
} catch {
  dllSkipped = true;
}
await cp(path.join(repo, "assets", "sudachi"), path.join(target, "assets", "sudachi"), {
  recursive: true,
});
const devPaths = {
  dictPath: path.join(repo, "assets", "dict", "system_full.dic").replaceAll("\\", "/"),
  resourceDir: path.join(repo, "assets", "sudachi").replaceAll("\\", "/"),
  pinyinDictPath: path.join(repo, "assets", "pinyin", "complete.json").replaceAll("\\", "/"),
  jmdictPath: path.join(repo, "assets", "jmdict", "readings.json").replaceAll("\\", "/"),
};
await writeFile(path.join(target, "dev-paths.json"), JSON.stringify(devPaths, null, 2));
console.log(`Installed to ${target}`);
if (dllSkipped) {
  console.log("backend.dll is in use (NCM running) and was NOT replaced.");
  console.log("Quit NCM completely, run dev-install again, then start NCM.");
} else {
  console.log("Restart NetEase Cloud Music completely (quit from the tray) so the native DLL loads.");
}
