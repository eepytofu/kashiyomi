// Steady-state cost of the pure engine, per lyric line.
//
// This is the baseline half of the Stage 2 benchmark: everything measurable
// without NCM. The other half — the once-a-second MutationObserver scan, DOM
// write cost, first-annotation latency — needs a live player and is not
// simulated here, because a simulation of NCM's DOM would measure our guess
// about NCM rather than NCM.
//
// Budgets are set in BUDGETS below and were written before the first run. A
// number with no threshold is a number nobody acts on.
//
// Run: npm run bench
//
// Lines are real, from songs already captured into the test fixtures.
import { classifyLines } from "../src/engine/lineKinds.ts";
import { resolveDocumentContext, resolveLineRoute } from "../src/engine/cjk.ts";
import { prepareJapaneseLine } from "../src/engine/lineText.ts";
import { annotateJapaneseLine } from "../src/engine/japanese.ts";
import { repairJapaneseHan } from "../src/engine/hanRepair.ts";
import { registerCompleteDict, romanizeMandarin } from "../src/engine/pinyin.ts";
import CompleteDict from "@pinyin-pro/data/complete";
import { execFileSync } from "node:child_process";

registerCompleteDict(CompleteDict);

/**
 * Per line, in milliseconds. The reasoning, since a threshold nobody can
 * justify gets raised the first time it fails:
 *
 * A song is 60-90 lines. The whole engine pass runs on a track change and
 * again on every re-annotate, and the user is staring at the lyrics page while
 * it happens. 1ms/line puts a 90-line song at 90ms, which is under the ~100ms
 * that reads as instant. That is the bar for anything running per line.
 *
 * The document-level passes run once per song, not per line, so they are
 * budgeted against the whole song rather than divided.
 */
const BUDGETS = {
  "cjk: document context": 5,
  "cjk: route one line": 1,
  "lineKinds: classify song": 5,
  "hanRepair: one line": 1,
  "lineText: prepare one line": 1,
  "japanese: annotate one line": 1,
  "pinyin: romanize one line": 1,
  // The figure the user actually waits through on a track change. 100ms is the
  // threshold above which a UI response stops reading as instant.
  "whole song: 70 mandarin lines": 100,
};

// Captured lyric lines. Japanese from 千本桜 / Bad Apple!! / 灯篭, Mandarin from
// 白马过了离原 / 下等马 / 归家 — all already in the test fixtures.
const JP = [
  "今宵も天は明るく",
  "千本桜 夜ニ紛レ",
  "こんな瞳から写った自分は",
  "されどこんな空っぽな僕の体",
  "だんだん剥がれてく Fake のゴールド",
  "僕らの居場所はどこなんだ",
  "夢見ては儚く散る",
];
const ZH = [
  "白马过了离原，三月的天，春风漫草野",
  "张伞一抬眼，细雨落额前",
  "在悬崖看红霞",
  "但我爱的人都会一个一个死去",
  "庭中树，初长成还不及肩",
  "此曲只应天上有",
  "舍不得你走",
];

/** A realistic song length, built by cycling the captured lines. */
const song = (src, n = 70) => Array.from({ length: n }, (_, i) => src[i % src.length]);
const JP_SONG = song(JP);
const ZH_SONG = song(ZH);

// Tokens for the Japanese annotator. Hand-built fixtures would be a lie here
// (the analyzer is what produces these), so the annotate benchmark runs on the
// one line whose real tokenization is pinned in the test suite.
const TOKENS = [
  { surface: "今宵", start: 0, end: 2, readingKana: "コヨイ", partOfSpeech: "noun", rawPos: ["名詞", "普通名詞", "副詞可能", "*", "*", "*"], oov: false },
  { surface: "も", start: 2, end: 3, readingKana: "モ", partOfSpeech: "particle", rawPos: ["助詞", "係助詞", "*", "*", "*", "*"], oov: false },
  { surface: "天", start: 3, end: 4, readingKana: "テン", partOfSpeech: "noun", rawPos: ["名詞", "普通名詞", "一般", "*", "*", "*"], oov: false },
  { surface: "は", start: 4, end: 5, readingKana: "ハ", partOfSpeech: "particle", rawPos: ["助詞", "係助詞", "*", "*", "*", "*"], oov: false },
  { surface: "明るく", start: 5, end: 8, readingKana: "アカルク", partOfSpeech: "other", rawPos: ["形容詞", "一般", "*", "*", "形容詞", "連用形-一般"], oov: false },
];
const TOKEN_LINE = "今宵も天は明るく";

function bench(name, fn, iterations) {
  fn(); // warm up: first call pays for lazy OpenCC converters and JIT
  const started = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const perOp = (performance.now() - started) / iterations;
  const budget = BUDGETS[name];
  const verdict = budget === undefined ? "" : perOp <= budget ? "ok" : "OVER";
  results.push({ name, perOp, budget, verdict });
}

const results = [];
const jpDoc = resolveDocumentContext(JP_SONG);
const zhDoc = resolveDocumentContext(ZH_SONG);
const classifiable = ZH_SONG.map((text) => ({ text, translation: "unknown" }));
const opts = { hanRepair: true, readingHints: true };

bench("cjk: document context", () => resolveDocumentContext(JP_SONG), 2000);
bench("cjk: route one line", () => resolveLineRoute(JP_SONG[0], jpDoc), 20000);
bench("lineKinds: classify song", () => classifyLines(classifiable), 2000);
bench("hanRepair: one line", () => repairJapaneseHan(JP_SONG[0]), 20000);
bench("lineText: prepare one line", () => prepareJapaneseLine(JP_SONG[0], opts), 20000);
bench("japanese: annotate one line", () => annotateJapaneseLine(TOKEN_LINE, TOKENS), 20000);
bench("pinyin: romanize one line", () => romanizeMandarin(ZH_SONG[0], { tones: true, joinWords: true }), 5000);

// Whole-song figures, which is what the user actually waits through.
const songPass = () => {
  const doc = resolveDocumentContext(ZH_SONG);
  for (const line of ZH_SONG) {
    if (resolveLineRoute(line, doc) === "chinese") romanizeMandarin(line, { tones: true, joinWords: true });
  }
};
bench("whole song: 70 mandarin lines", songPass, 200);

// A baseline taken on battery is not comparable to a re-run on AC — Windows
// drops the clock hard on battery — and the whole point of this file is that it
// gets re-run after the refactor and compared. So the run records its own
// conditions rather than trusting anyone to remember them.
function powerState() {
  try {
    const out = execFileSync(
      "powershell",
      ["-NoProfile", "-Command", "(Get-CimInstance Win32_Battery).BatteryStatus"],
      { encoding: "utf8", timeout: 10000 },
    ).trim();
    if (out === "") return "desktop (no battery)";
    // 1 = discharging, 2 = on AC. Anything else is a charging//low state.
    return out.startsWith("2") ? "AC power" : out.startsWith("1") ? "ON BATTERY" : `battery status ${out}`;
  } catch {
    return "unknown";
  }
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`node ${process.version}  ·  ${powerState()}  ·  ${new Date().toISOString().slice(0, 16)}`);
console.log(`${pad("operation", 32)}${pad("per op", 12)}${pad("budget", 10)}verdict`);
console.log("-".repeat(62));
for (const r of results) {
  console.log(
    pad(r.name, 32) +
      pad(`${r.perOp.toFixed(4)} ms`, 12) +
      pad(r.budget === undefined ? "-" : `${r.budget} ms`, 10) +
      r.verdict,
  );
}
const over = results.filter((r) => r.verdict === "OVER");
console.log(over.length === 0 ? "\nall within budget" : `\n${over.length} OVER BUDGET`);
process.exit(over.length === 0 ? 0 : 1);
