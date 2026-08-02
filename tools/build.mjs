import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "iife",
  // NCM 3.1.37 runs CEF 91 (Chromium 91.0.4472); do not raise without re-checking.
  target: ["chrome91"],
  outfile: "dist/main.js",
  logLevel: "info",
  // The pinyin complete dictionary must never be bundled; it is loaded from
  // disk at runtime via betterncm.fs.mountDir + dynamic import.
  external: ["@pinyin-pro/data/complete"],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
