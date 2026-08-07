// Fails the build on CSS this runtime silently ignores.
//
//   node tools/check-cef91.mjs
//
// NCM is CEF 91 (Chromium 91). The JS side of that constraint never bites,
// because `tsc` knows the lib target and rejects `Array.at` and `Object.hasOwn`
// before anyone runs anything. **CSS has no such gate**: an unsupported
// property is not an error, it is a declaration the engine drops, so the page
// renders subtly wrong and everything passes.
//
// That gap has cost the same mistake twice, both times a form control styled
// with `accent-color` (Chromium 93): once on the furigana size slider, then
// again on the setup dialog's radios, *after* the constraint was already
// written down in the project's own environment notes. A list nobody consults
// while writing CSS is not a control. This is.
//
// Scanning source rather than the bundle, because the point is to name the file
// and line. Comments are stripped first: several of these properties are
// discussed by name in comments explaining why they are absent, and flagging
// those would train everyone to ignore the output.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "src");

/**
 * Each entry is a thing Chromium shipped after 91, with the version that got it.
 * Add to this list whenever a check against the running app turns one up; the
 * cost of a wrong entry is a false failure, which is loud and cheap to fix.
 */
const BANNED = [
  { pattern: /accent-color\s*:/g, name: "accent-color", since: "Chromium 93" },
  { pattern: /:has\(/g, name: ":has()", since: "Chromium 105" },
  { pattern: /:modal\b/g, name: ":modal", since: "Chromium 105" },
  { pattern: /\binert\s*=/g, name: "the inert attribute", since: "Chromium 102" },
  { pattern: /\.inert\s*=/g, name: "the inert property", since: "Chromium 102" },
  { pattern: /@container\b/g, name: "@container", since: "Chromium 105" },
  { pattern: /@layer\b/g, name: "@layer", since: "Chromium 99" },
  { pattern: /color-mix\(/g, name: "color-mix()", since: "Chromium 111" },
  { pattern: /\boklch\(|\boklab\(/g, name: "oklch()/oklab()", since: "Chromium 111" },
  { pattern: /text-wrap\s*:\s*balance/g, name: "text-wrap: balance", since: "Chromium 114" },
  { pattern: /text-spacing-trim\s*:/g, name: "text-spacing-trim", since: "Chromium 123" },
  { pattern: /text-autospace\s*:/g, name: "text-autospace", since: "after Chromium 91" },
  { pattern: /scrollbar-(width|color)\s*:/g, name: "scrollbar-width/color", since: "Chromium 121" },
  { pattern: /field-sizing\s*:/g, name: "field-sizing", since: "Chromium 123" },
  { pattern: /\b\d+(?:\.\d+)?(dvh|svh|lvh|dvw|svw|lvw)\b/g, name: "dynamic viewport units", since: "Chromium 108" },
  { pattern: /\bsubgrid\b/g, name: "subgrid", since: "Chromium 117" },
];

/** Comments are where these properties are legitimately named. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/^\s*\/\/.*$/gm, "");
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (full.endsWith(".ts")) yield full;
  }
}

let failures = 0;
for (const file of walk(ROOT)) {
  const lines = stripComments(readFileSync(file, "utf8")).split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const { pattern, name, since } of BANNED) {
      pattern.lastIndex = 0;
      if (!pattern.test(line)) continue;
      failures += 1;
      const rel = path.relative(path.resolve(ROOT, ".."), file).replaceAll("\\", "/");
      console.error(`${rel}:${index + 1}  ${name} is ${since}; CEF 91 drops it silently`);
      console.error(`  ${line.trim().slice(0, 100)}`);
    }
  });
}

if (failures > 0) {
  console.error(`\n${failures} unsupported declaration(s). Style it by hand, or verify support over CDP first.`);
  process.exit(1);
}
console.log("CEF 91: no unsupported CSS or DOM features in src/");
