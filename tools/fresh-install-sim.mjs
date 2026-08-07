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
// pointer moves. `dev-paths.json` is redirected to an empty directory, the
// settings that record what has been installed and answered are cleared, and
// both are written to a backup file first. `off` restores from that backup.
//
// A download started while this is on is real, and lands in the sandbox
// directory rather than next to the real dictionaries. That is the point: it
// exercises fetch, verify, extract, swap and load end to end without putting a
// development checkout's own dictionary at risk.

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";

const PLUGIN = "C:/betterncm/plugins_dev/Kashiyomi";
const PATHS = `${PLUGIN}/dev-paths.json`;
const BACKUP = `${PLUGIN}/_fresh-sim-backup.json`;
const SANDBOX = "C:/betterncm/kashiyomi-fresh-sim";
const SETTINGS_KEY = "kashiyomi:settings";
/** Cleared by `on`, restored by `off`: everything recording what has been done. */
const CLEARED = ["dictSetupSeen", "dictVersions", "dictPreferredEdition"];
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
  if (on) console.log(`  backup: ${BACKUP}\n  run: node tools/fresh-install-sim.mjs off`);
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

  writeFileSync(
    BACKUP,
    JSON.stringify({ devPaths: paths, settings: Object.fromEntries(CLEARED.map((k) => [k, settings[k]])) }, null, 2),
  );
  mkdirSync(SANDBOX, { recursive: true });
  writeFileSync(PATHS, JSON.stringify({ ...paths, dictDir: SANDBOX }, null, 2));

  const fresh = { ...settings };
  for (const key of CLEARED) delete fresh[key];
  await writeSettings(evaluate, fresh);
  await reload();
  ws.close();

  console.log("ON. NCM now behaves as a machine with no dictionary.");
  console.log(`  real dictionaries: untouched, still at ${paths.dictDir}`);
  console.log(`  downloads land in: ${SANDBOX}`);
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
  const settings = await readSettings(evaluate);
  for (const [key, value] of Object.entries(backup.settings)) {
    if (value === undefined) delete settings[key];
    else settings[key] = value;
  }
  await writeSettings(evaluate, settings);
  await reload();
  ws.close();

  rmSync(BACKUP, { force: true });
  rmSync(SANDBOX, { recursive: true, force: true });
  console.log("off. dev-paths.json, settings and the sandbox directory are back as they were.");
  process.exit(0);
}

console.error(`unknown mode "${mode}". Use on, off or status.`);
process.exit(1);
