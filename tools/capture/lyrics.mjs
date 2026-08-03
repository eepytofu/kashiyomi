// Capture the lyric lines NetEase is actually rendering, over the Chrome
// DevTools Protocol. This is what makes a test fixture traceable: a fixture
// typed from memory has been wrong three times (see LESSONS.md), most recently
// a 千本桜 line the song does not contain, which sat in two tests as the proof
// that Japanese-only glyph detection works.
//
//   node tools/capture/lyrics.mjs                 # pretty summary
//   node tools/capture/lyrics.mjs --json > x.json # machine-readable
//
// NCM must be running with --remote-debugging-port=9223; see BETTERNCM.md.
//
// Two things this gets right that an ad-hoc snippet does not:
//
//   - It reads `data-kashiyomi-src`, the untouched original, in preference to
//     the rendered text. Kanji repair rewrites the DOM (繼續 -> 継続), so
//     reading textContent back can capture our own output as if it were the
//     source. That exact mistake produced a whole misdesigned routing ladder.
//   - It records translation presence per line, which only exists in the DOM
//     while NCM's 译 toggle is on and is not recoverable from the text.

const PORT = process.env.NCM_DEBUG_PORT ?? "9223";
const asJson = process.argv.includes("--json");

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
      if (msg.result.exceptionDetails) {
        return reject(new Error(JSON.stringify(msg.result.exceptionDetails)));
      }
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

// Kept in sync with LINE_SELECTORS and hasProviderTranslationSibling in
// src/host/lyricDom.ts. Duplicated rather than imported because this runs
// inside NCM's page, not in our module graph.
const script = String.raw`(() => {
  const SELECTORS = ["ul.lyric li p", 'ul[class*="lyric"] li p', ".lyric-scroll p"];
  let nodes = [];
  for (const selector of SELECTORS) {
    const matches = [...document.querySelectorAll(selector)];
    if (matches.length >= 2) { nodes = matches; break; }
  }
  const HAN = /\p{Script=Han}/u;
  const KANA = /[ぁ-ゟ゠-ヿｦ-ﾟ]/u;
  const rendered = (el) => {
    const clone = el.cloneNode(true);
    for (const own of clone.querySelectorAll(".kashiyomi-row, rt")) own.remove();
    return (clone.textContent ?? "").trim();
  };
  const lines = [];
  let fromAttr = 0;
  for (const el of nodes) {
    // Only the first <p> in an entry is the lyric; 译 and 音 render as later
    // siblings of it.
    const li = el.closest("li");
    if (!li || li.querySelector("p") !== el) continue;
    const stored = el.getAttribute("data-kashiyomi-src");
    if (stored !== null) fromAttr += 1;
    const text = stored ?? rendered(el);
    if (text === "") continue;
    let translated = false;
    for (let sib = el.nextElementSibling; sib; sib = sib.nextElementSibling) {
      if (sib.tagName !== "P") continue;
      const t = (sib.textContent ?? "").trim();
      if (HAN.test(t) && !KANA.test(t)) translated = true;
    }
    lines.push({ text, translated, onScreen: rendered(el) });
  }
  return JSON.stringify({
    capturedAt: new Date().toISOString(),
    // How many lines came from the stored original rather than the screen. If
    // this is below lines.length the plugin had not annotated everything yet;
    // rescan and capture again before trusting the text.
    fromSourceAttribute: fromAttr,
    translationRowsVisible: lines.some((l) => l.translated),
    lines,
  });
})()`;

const raw = await evaluate(script);
ws.close();

if (asJson) {
  console.log(raw);
} else {
  const data = JSON.parse(raw);
  const repaired = data.lines.filter((l) => l.text !== l.onScreen).length;
  console.log(`${data.lines.length} lines, ${data.fromSourceAttribute} from data-kashiyomi-src`);
  console.log(`译 rows visible: ${data.translationRowsVisible}`);
  console.log(`lines the plugin rewrote on screen: ${repaired}`);
  if (data.fromSourceAttribute < data.lines.length) {
    console.log("WARNING: some lines fell back to screen text; capture again after a rescan");
  }
  console.log("");
  for (const line of data.lines) {
    console.log(`${line.translated ? "tx" : "  "}  ${line.text}`);
  }
}
