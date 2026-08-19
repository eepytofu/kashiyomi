// Mutation-testing harness for the engine suites.
//
// Applies one deliberate behaviour change at a time, runs the tests, and
// reports which ones noticed. A mutation the suite survives is a hole in the
// tests — or, once checked against a discriminating input, dead code.
//
//   node tools/mutation/run.mjs tools/mutation/cjk-mutations.json
//   node tools/mutation/run.mjs tools/mutation/engine-mutations.json <id>...
//
// **The working tree is never written to.** Everything happens in a throwaway
// copy under the OS temp directory, and the mutated file is written there.
//
// It used to mutate the checkout in place and restore in a `finally`, an exit
// handler and every signal — which still lost twice, because a hard kill runs
// none of those and left `apiKeys.ts` holding a mutant with key rotation
// silently disabled. Restoring correctly is a weaker property than never
// breaking it: with a copy there is nothing to restore, the sweep no longer
// blocks editing, building, typechecking or committing while it runs, and a
// kill at any moment leaves the checkout exactly as it was.
//
// The copy is src/ + tests/ + package.json (for `"type": "module"`), with
// node_modules as a junction rather than a copy — 480 KB against gigabytes.

import { spawnSync } from "node:child_process";
import { cpSync, copyFileSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WORK = path.join(os.tmpdir(), `kashiyomi-mutate-${process.pid}`);
const touched = new Set(); // repo-relative files this run mutated, for the summary

/** Pristine source, always read from the checkout and never written back. */
const pristine = (file) => readFileSync(path.resolve(REPO, file), "utf8");
/** Where a mutation is actually written. */
const workPath = (file) => path.resolve(WORK, file);

function buildWorkspace() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  cpSync(path.join(REPO, "src"), path.join(WORK, "src"), { recursive: true });
  cpSync(path.join(REPO, "tests"), path.join(WORK, "tests"), { recursive: true });
  copyFileSync(path.join(REPO, "package.json"), path.join(WORK, "package.json"));
  copyFileSync(path.join(REPO, "dictionary-releases.json"), path.join(WORK, "dictionary-releases.json"));
  // A junction, so Windows does not need administrator rights and the several
  // hundred megabytes under node_modules are not copied per sweep.
  symlinkSync(path.join(REPO, "node_modules"), path.join(WORK, "node_modules"), "junction");
}

function cleanupWorkspace() {
  try {
    rmSync(WORK, { recursive: true, force: true });
  } catch {
    // Leaving a temp directory behind is harmless; failing the sweep over it is not.
  }
}

process.on("exit", cleanupWorkspace);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
  process.on(sig, () => {
    cleanupWorkspace();
    process.exit(130);
  });
}

function runTests() {
  const r = spawnSync(
    process.execPath,
    ["--test", "--test-reporter=tap", "tests/*.test.ts"],
    { cwd: WORK, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
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

buildWorkspace();

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
      // Always from the checkout, never from the workspace: a previous
      // mutation must not be able to seed the next one.
      const original = pristine(m.file);
      const hits = original.split(m.find).length - 1;
      if (hits !== 1) throw new Error(`pattern matched ${hits} times, expected exactly 1`);
      writeFileSync(workPath(m.file), original.replace(m.find, m.replace));
      touched.add(m.file);
      outcome = { ...runTests(), id: m.id, what: m.what };
    } catch (err) {
      outcome = { id: m.id, what: m.what, error: err.message };
    } finally {
      // Put the workspace copy back so the next mutation starts clean.
      try {
        writeFileSync(workPath(m.file), pristine(m.file));
      } catch {
        // A mutation naming a file that does not exist already errored above.
      }
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
  cleanupWorkspace();
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

console.log(`\n${touched.size} file(s) mutated, all in ${path.relative(os.tmpdir(), WORK)} — the checkout was never written to`);
