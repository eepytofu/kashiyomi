// Put this machine into the state a brand new install is in, and get it back.
//
//   node tools/fresh-install-sim.mjs on     pretend nothing is installed
//   node tools/fresh-install-sim.mjs off    put everything back
//   node tools/fresh-install-sim.mjs status
//
// The first-run experience is unreachable on a development machine, because
// development machines are exactly the ones that already have a dictionary.
// Every check of it so far has been a probe that reads the DOM and restores
// itself, which proves the code runs but does not let anyone *use* the thing.
//
// **Nothing is deleted.** The real dictionaries stay where they are; only the
// pointer moves. `dev-paths.json` is redirected to an empty directory, *every*
// setting is cleared, and both are written to a backup file first. `off`
// restores from that backup.
//
// The whole settings blob is snapshotted rather than a named list of keys. The
// list version silently rotted: it still named `dictVersions` and
// `dictPreferredEdition` months after both were deleted, and it never learned
// about `dictCheckedAt`, so a "fresh" install would have started out already
// throttled against checking for updates. A snapshot cannot go stale, and
// clearing everything is also what "new install" actually means — the API key,
// the font stack and the toggles are all part of the experience being tested.
//
// A download started while this is on is real, and lands in the sandbox
// directory rather than next to the real dictionaries. That is the point: it
// exercises fetch, verify, extract, swap and load end to end without putting a
// development checkout's own dictionary at risk.

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";

const PLUGIN = "C:/betterncm/plugins_dev/Kashiyomi";
const PATHS = `${PLUGIN}/dev-paths.json`;
// **Outside the plugin directory, deliberately.** `npm run dev-install` starts
// with `rm(target, { recursive: true })`, so a backup kept beside the plugin is
// destroyed by the next install — which happened, taking the only copy of the
// real settings with it. Nothing in `C:/betterncm` itself is touched by an
// install.
const BACKUP = "C:/betterncm/kashiyomi-fresh-sim-backup.json";
const SANDBOX = "C:/betterncm/kashiyomi-fresh-sim";
const SETTINGS_KEY = "kashiyomi:settings";
const PORT = process.env.NCM_DEBUG_PORT ?? "9223";

async function cdp() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = targets.find((t) => t.type === "page" && /app\.html/.test(t.url ?? ""));
  if (!page) throw new Error(`no NCM page on port ${PORT}. Is it running with --remote-debugging-port=${PORT}?`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener("open", r, { once: true });
    ws.addEventListener("error", j, { once: true });
  });
  let id = 1;
  const send = (method, params = {}) => {
    const mine = id++;
    return new Promise((resolve, reject) => {
      const onMessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.id !== mine) return;
        ws.removeEventListener("message", onMessage);
        if (m.result?.exceptionDetails) reject(new Error(JSON.stringify(m.result.exceptionDetails)));
        else resolve(m.result?.result?.value);
      };
      ws.addEventListener("message", onMessage);
      ws.send(JSON.stringify({ id: mine, method, params }));
    });
  };
  const evaluate = (expression) => send("Runtime.evaluate", { expression, returnByValue: true });
  const reload = async () => {
    await send("Page.reload", { ignoreCache: true });
    await new Promise((r) => setTimeout(r, 11000));
  };
  return { ws, evaluate, reload };
}

const readSettings = (evaluate) =>
  evaluate(`localStorage.getItem(${JSON.stringify(SETTINGS_KEY)})`).then((raw) =>
    raw ? JSON.parse(raw) : {},
  );

const writeSettings = (evaluate, settings) =>
  evaluate(
    `localStorage.setItem(${JSON.stringify(SETTINGS_KEY)}, ${JSON.stringify(JSON.stringify(settings))})`,
  );

const mode = process.argv[2] ?? "status";

if (mode === "status") {
  const on = existsSync(BACKUP);
  console.log(on ? "ON  (pretending nothing is installed)" : "off (normal)");
  if (on) {
    console.log(`  backup: ${BACKUP}`);
    // A dev-install rewrites dev-paths.json unconditionally, which points the
    // plugin back at the real dictionary while this still claims to be on. That
    // is a silent un-sim, so say it rather than let a first-run test quietly
    // run against a machine that has a dictionary after all.
    const redirected = existsSync(PATHS)
      ? JSON.parse(readFileSync(PATHS, "utf8")).dictDir === SANDBOX
      : false;
    if (!redirected) {
      console.log("  WARNING: dev-paths.json no longer points at the sandbox.");
      console.log("  A dev-install reset it. Run `off` then `on` again.");
    }
    console.log("  run: node tools/fresh-install-sim.mjs off");
  }
  process.exit(0);
}

if (mode === "on") {
  // Refusing rather than re-snapshotting is the whole safety property here: a
  // second `on` would record the *pretend* state as the thing to restore, and
  // the real dictionary versions would be gone with no way back.
  if (existsSync(BACKUP)) {
    console.error("Already on. Run `off` first, or the real state would be overwritten.");
    process.exit(1);
  }
  const paths = JSON.parse(readFileSync(PATHS, "utf8"));
  const { ws, evaluate, reload } = await cdp();
  const settings = await readSettings(evaluate);

  writeFileSync(BACKUP, JSON.stringify({ devPaths: paths, settings }, null, 2));
  mkdirSync(SANDBOX, { recursive: true });
  writeFileSync(PATHS, JSON.stringify({ ...paths, dictDir: SANDBOX }, null, 2));

  // Removed outright rather than written as `{}`: the plugin has to take the
  // branch a real new install takes, which is "no stored settings at all".
  await evaluate(`localStorage.removeItem(${JSON.stringify(SETTINGS_KEY)})`);
  await reload();
  ws.close();

  const kept = Object.keys(settings).length;
  console.log("ON. NCM now behaves as a brand new install.");
  console.log(`  real dictionaries: untouched, still at ${paths.dictDir}`);
  console.log(`  downloads land in: ${SANDBOX}`);
  console.log(`  settings: all ${kept} key(s) cleared, saved in ${BACKUP}`);
  console.log("  back to normal:    node tools/fresh-install-sim.mjs off");
  process.exit(0);
}

if (mode === "off") {
  if (!existsSync(BACKUP)) {
    console.error("Not on: no backup to restore from.");
    process.exit(1);
  }
  const backup = JSON.parse(readFileSync(BACKUP, "utf8"));
  const { ws, evaluate, reload } = await cdp();

  writeFileSync(PATHS, JSON.stringify(backup.devPaths, null, 2));
  // The snapshot replaces whatever the pretend run left behind, rather than
  // merging into it: anything set while the sim was on belongs to the sim.
  await writeSettings(evaluate, backup.settings);
  await reload();
  ws.close();

  rmSync(BACKUP, { force: true });
  rmSync(SANDBOX, { recursive: true, force: true });
  console.log("off. dev-paths.json, settings and the sandbox directory are back as they were.");
  process.exit(0);
}

console.error(`unknown mode "${mode}". Use on, off or status.`);
process.exit(1);
