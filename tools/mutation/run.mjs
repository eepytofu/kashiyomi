// Mutation-testing harness for the engine suites.
//
// Applies one deliberate behaviour change at a time, runs the tests, and
// reports which ones noticed. A mutation the suite survives is a hole in the
// tests — or, once checked against a discriminating input, dead code.
//
//   node tools/mutation/run.mjs tools/mutation/cjk-mutations.json
//   node tools/mutation/run.mjs tools/mutation/engine-mutations.json <id>...
//
// Restoration is the point of the structure here: an interrupted sweep once
// left mutated source in the tree, silently breaking NFKC normalization.
// Originals are snapshotted before the first write and restored in a
// `finally`, from a process-exit handler, and on every termination signal, so
// a killed run still cleans up.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const originals = new Map(); // absolute path -> original text
let dirty = false;

const abs = (file) => path.resolve(REPO, file);

function snapshot(file) {
  const p = abs(file);
  if (!originals.has(p)) originals.set(p, readFileSync(p, "utf8"));
  return originals.get(p);
}

function restoreAll() {
  if (!dirty) return;
  for (const [p, text] of originals) writeFileSync(p, text);
  dirty = false;
}

process.on("exit", restoreAll);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
  process.on(sig, () => {
    restoreAll();
    process.exit(130);
  });
}

function runTests() {
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--test", "--test-reporter=tap", "tests/*.test.ts"],
    { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  const failed = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^not ok \d+ - (.+)$/.exec(line.trim());
    if (m) failed.push(m[1].trim());
  }
  // No `ok` line at all means the suite could not run: a syntax error rather
  // than a clean behaviour change, so the mutation proved nothing.
  return { failed, crashed: !/^ok \d+/m.test(out) };
}

const mutations = JSON.parse(readFileSync(process.argv[2], "utf8"));
const only = process.argv.slice(3);

const baseline = runTests();
if (baseline.crashed || baseline.failed.length > 0) {
  console.error("baseline suite is not green; the harness cannot measure anything");
  process.exit(1);
}
console.log("baseline green\n");

const results = [];
try {
  for (const m of mutations) {
    if (only.length > 0 && !only.includes(m.id)) continue;
    let outcome;
    try {
      const original = snapshot(m.file);
      const hits = original.split(m.find).length - 1;
      if (hits !== 1) throw new Error(`pattern matched ${hits} times, expected exactly 1`);
      writeFileSync(abs(m.file), original.replace(m.find, m.replace));
      dirty = true;
      outcome = { ...runTests(), id: m.id, what: m.what };
    } catch (err) {
      outcome = { id: m.id, what: m.what, error: err.message };
    } finally {
      restoreAll();
    }
    results.push(outcome);
    const tag = outcome.error
      ? "ERROR   "
      : outcome.crashed
        ? "CRASH   "
        : outcome.failed.length === 0
          ? "SURVIVED"
          : "killed  ";
    console.log(`${tag} ${m.id.padEnd(34)} ${outcome.error ?? `${outcome.failed.length} test(s)`}`);
    for (const f of outcome.failed?.slice(0, 6) ?? []) console.log(`         - ${f}`);
  }
} finally {
  restoreAll();
}

const survived = results.filter((r) => !r.error && !r.crashed && r.failed.length === 0);
console.log(`\n${results.length} mutations, ${survived.length} SURVIVED`);
for (const s of survived) console.log(`  SURVIVED  ${s.id} — ${s.what}`);

// A mutation whose pattern no longer matches has stopped testing anything, and
// the summary above would still read "0 SURVIVED". Editing the source it
// targets is exactly when that happens, so make it loud and fatal.
const errored = results.filter((r) => r.error);
if (errored.length > 0) {
  console.error(`\n${errored.length} mutation(s) never ran — the suite proved less than it looks:`);
  for (const e of errored) console.error(`  ERROR  ${e.id} — ${e.error}`);
  process.exitCode = 1;
}

// Verify against the snapshots, not against git: the tree is legitimately
// dirty whenever the sweep is run on work in progress, which is most of the
// time. What matters is that every file we touched is byte-identical to how
// we found it.
const unrestored = [...originals]
  .filter(([p, text]) => readFileSync(p, "utf8") !== text)
  .map(([p]) => path.relative(REPO, p));
console.log(`\n${originals.size} file(s) touched, all restored: ${unrestored.length === 0}`);
if (unrestored.length > 0) {
  console.error("SOURCE LEFT MUTATED — restore before continuing:\n" + unrestored.join("\n"));
  process.exitCode = 1;
}
