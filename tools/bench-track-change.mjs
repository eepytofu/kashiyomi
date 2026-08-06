// First-annotation latency: how long a new song's lyrics sit unannotated
// before the rows appear. The one performance number a user can actually see.
//
//   node tools/bench-track-change.mjs      # then change the track in NCM
//
// Detection keys on `data-kashiyomi-src`, never on textContent. Injected rows
// change textContent, so "have the lyrics changed" cannot be asked of the text —
// that confusion is the reason SRC_ATTR exists in the first place.

const PORT = process.env.NCM_DEBUG_PORT ?? "9223";
const TIMEOUT_MS = 120000;

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = targets.find((t) => t.type === "page" && !/devtools:/.test(t.url ?? ""));
if (!page) throw new Error(`no page target on port ${PORT}`);

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => {
  ws.addEventListener("open", r, { once: true });
  ws.addEventListener("error", j, { once: true });
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
      id, method: "Runtime.evaluate",
      params: { expression, returnByValue: true, awaitPromise: true },
    }));
  });
}

await evaluate(`(() => {
  if (globalThis.__kbTimer) clearInterval(globalThis.__kbTimer);
  const nodes = () => document.querySelectorAll("ul.lyric li p");
  const annotated = () => document.querySelectorAll("[data-kashiyomi-src]").length;
  // Every track change is a sample, not just the first: one measurement of a
  // thing this variable is an anecdote.
  const kb = { samples: [], pending: null };
  globalThis.__kb = kb;
  let lastN = nodes().length, lastA = annotated();
  globalThis.__kbTimer = setInterval(() => {
    const n = nodes().length, a = annotated();
    // A new song arrives as nodes that carry no source attribute yet. Keying on
    // the attribute rather than the text is deliberate.
    if (kb.pending === null && n > 0 && a < n && (lastA >= lastN || n !== lastN)) {
      kb.pending = { t0: performance.now(), nodeCount: n };
    }
    if (kb.pending !== null && n > 0 && a >= n) {
      kb.samples.push({ ms: performance.now() - kb.pending.t0, lines: n });
      kb.pending = null;
    }
    lastN = n; lastA = a;
  }, 5);
  return true;
})()`);

console.log("recorder armed. change tracks in NCM — as many as you like.");
console.log("waiting up to 2 minutes, reporting when you stop...\n");

const started = Date.now();
// Stop once samples stop arriving, so the user does not have to wait out the
// full timeout after their last skip.
const QUIET_MS = 20000;
let samples = [];
let lastChange = Date.now();
while (Date.now() - started < TIMEOUT_MS) {
  await new Promise((r) => setTimeout(r, 500));
  const kb = JSON.parse(await evaluate(`JSON.stringify(globalThis.__kb)`));
  if (kb.samples.length !== samples.length) {
    samples = kb.samples;
    lastChange = Date.now();
    const s = samples[samples.length - 1];
    console.log(`  #${samples.length}  ${s.ms.toFixed(1)} ms over ${s.lines} lines`);
  }
  if (samples.length > 0 && Date.now() - lastChange > QUIET_MS) break;
}

await evaluate(`clearInterval(globalThis.__kbTimer); globalThis.__kbTimer = null; true`);

if (samples.length === 0) {
  console.log("timed out with no completed track change.");
  ws.close();
  process.exit(2);
}

const BUDGET = 500;
const ms = samples.map((s) => s.ms).sort((a, b) => a - b);
const median = ms[Math.floor(ms.length / 2)];
const worst = ms[ms.length - 1];
console.log(`\nfirst-annotation latency over ${samples.length} track change(s)`);
console.log(`  best   ${ms[0].toFixed(1)} ms`);
console.log(`  median ${median.toFixed(1)} ms`);
console.log(`  worst  ${worst.toFixed(1)} ms   budget ${BUDGET} ms   ${worst <= BUDGET ? "ok" : "OVER"}`);
console.log(`\nsampled at 5ms, so treat anything under ~10ms as noise.`);
ws.close();
