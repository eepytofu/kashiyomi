// The half of the Stage 2 benchmark that needs a running player: what the
// plugin costs the lyrics page while a song is simply playing.
//
//   node tools/bench-live.mjs
//
// NCM must be running with --remote-debugging-port=9223, with a song loaded.
//
// The thing being chased is in kashiyomi.log: `selector "ul.lyric li p" matched
// 65 lines` fires roughly once a second, continuously, driven by NCM's own
// scroll and highlight churn rather than by anything we do. The annotated-check
// short-circuits it, so it is probably cheap — but "probably cheap, once a
// second, forever" is the shape of thing that gets measured, not assumed.
//
// Read-only. It never changes a setting: every measurement here is conditional
// on settings the user changes silently, so it records them instead.

const PORT = process.env.NCM_DEBUG_PORT ?? "9223";

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = targets.find((t) => t.type === "page" && !/devtools:/.test(t.url ?? ""));
if (!page) throw new Error(`no page target on port ${PORT}; is NCM running with remote debugging?`);

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});

let nextId = 1;
function evaluate(expression) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id !== id) return;
      ws.removeEventListener("message", onMessage);
      if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
      if (msg.result.exceptionDetails) return reject(new Error(JSON.stringify(msg.result.exceptionDetails)));
      resolve(msg.result.result.value);
    };
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify({
      id,
      method: "Runtime.evaluate",
      params: { expression, returnByValue: true, awaitPromise: true },
    }));
  });
}

const context = await evaluate(`(() => {
  const k = globalThis.kashiyomi;
  const nodes = document.querySelectorAll("ul.lyric li p");
  const title = document.querySelector(".m-pinfo .f-thide, .title, h1")?.textContent?.trim() ?? "";
  return JSON.stringify({
    analyzer: k?.state?.() ?? null,
    settings: k?.settings?.() ?? null,
    lyricNodes: nodes.length,
    annotated: document.querySelectorAll("[data-kashiyomi-src]").length,
    title,
  });
})()`);

const ctx = JSON.parse(context);
console.log("context (every number below is conditional on this)");
console.log(`  song title guess : ${ctx.title || "(not found in DOM)"}`);
console.log(`  analyzer         : ${JSON.stringify(ctx.analyzer)}`);
console.log(`  lyric <p> nodes  : ${ctx.lyricNodes}`);
console.log(`  annotated lines  : ${ctx.annotated}`);
console.log(`  settings         : ${JSON.stringify(ctx.settings)}`);
if (ctx.lyricNodes === 0) {
  console.log("\nNo lyric lines in the DOM. Open a song with lyrics before measuring.");
  process.exit(2);
}

/** Time an in-page expression, best-of to shed scheduler noise. */
async function timeInPage(label, body, iterations, budgetMs) {
  const ms = await evaluate(`(() => {
    const run = () => { ${body} };
    for (let w = 0; w < 3; w++) run();
    let best = Infinity;
    for (let r = 0; r < 5; r++) {
      const t0 = performance.now();
      for (let i = 0; i < ${iterations}; i++) run();
      const per = (performance.now() - t0) / ${iterations};
      if (per < best) best = per;
    }
    return best;
  })()`);
  results.push({ label, ms, budgetMs });
}

const results = [];

// The selector the observer runs, on its own.
await timeInPage("querySelectorAll over the list", `document.querySelectorAll("ul.lyric li p");`, 200, 2);

// The selector plus reading the source attribute off every node — the routing
// input, and the reason SRC_ATTR exists.
await timeInPage(
  "scan + read data-kashiyomi-src",
  `const n = document.querySelectorAll("ul.lyric li p");
   for (let i = 0; i < n.length; i++) { const s = n[i].getAttribute("data-kashiyomi-src") || n[i].textContent; }`,
  200,
  5,
);

// Layout-forcing read, for contrast: this is what a scan must never do.
await timeInPage(
  "scan + force layout (anti-pattern)",
  `const n = document.querySelectorAll("ul.lyric li p");
   let h = 0; for (let i = 0; i < n.length; i++) h += n[i].getBoundingClientRect().height;`,
  20,
  undefined,
);

// A full re-annotation pass over the whole song: the closest proxy available to
// first-annotation latency after a track change, minus the analyzer round trip,
// which is cached by then. This is the one number a user can actually see, as a
// flicker of unannotated lyrics.
const rescanMs = await evaluate(`(async () => {
  const k = globalThis.kashiyomi;
  if (!k || typeof k.rescan !== "function") return null;
  let best = Infinity;
  for (let r = 0; r < 5; r++) {
    const t0 = performance.now();
    await k.rescan();
    const took = performance.now() - t0;
    if (took < best) best = took;
  }
  return best;
})()`);
if (rescanMs !== null) results.push({ label: "kashiyomi.rescan() whole song", ms: rescanMs, budgetMs: 100 });

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n${pad("measurement", 38)}${pad("per run", 12)}${pad("budget", 10)}verdict`);
console.log("-".repeat(68));
let over = 0;
for (const r of results) {
  const verdict = r.budgetMs === undefined ? "" : r.ms <= r.budgetMs ? "ok" : "OVER";
  if (verdict === "OVER") over += 1;
  console.log(pad(r.label, 38) + pad(`${r.ms.toFixed(4)} ms`, 12) + pad(r.budgetMs === undefined ? "-" : `${r.budgetMs} ms`, 10) + verdict);
}
console.log(
  over === 0
    ? "\nall within budget"
    : `\n${over} OVER BUDGET`,
);
ws.close();
