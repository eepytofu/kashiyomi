// Watches NCM's lyric DOM and annotates lines in place. Lines are matched by
// their text content, not by class names, so NCM markup churn degrades to
// "no annotation" instead of breaking. Elements NCM recycles are detected by
// comparing the stored original text and re-annotated.

import { resolveDocumentBranch, resolveLineRoute } from "../engine/cjk.ts";
import { repairJapaneseHan } from "../engine/hanRepair.ts";
import { projectReadingHints } from "../engine/hints.ts";
import { annotateJapaneseLine } from "../engine/japanese.ts";
import { romanizeMandarin } from "../engine/pinyin.ts";
import { hasHan } from "../engine/kana.ts";
import { nativeAnalyze } from "./native.ts";
import { ensurePinyinDict } from "./pinyinDict.ts";
import { MARK_ATTR, ROW_CLASS, renderJapaneseLine, renderPinyinRow } from "./render.ts";
import { getSettings } from "./settings.ts";
import { log } from "./log.ts";
import type { AssetPaths } from "./paths.ts";

// NCM 3.x native lyric lines. Kept deliberately short; findLineElements logs
// candidate counts so new selectors can be added from live debugging.
const LINE_SELECTORS = [
  "ul.lyric li p",
  'ul[class*="lyric"] li p',
  ".lyric-scroll p",
];

let assetPaths: AssetPaths | undefined;
let observer: MutationObserver | undefined;
let scanScheduled = false;
let pendingRetry: number | undefined;

export function startAnnotator(paths: AssetPaths): void {
  assetPaths = paths;
  observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  scheduleScan();
  log.info("annotator started");
}

export function rescan(): void {
  for (const el of document.querySelectorAll(`[${MARK_ATTR}]`)) {
    el.removeAttribute(MARK_ATTR);
  }
  scheduleScan();
}

function scheduleScan(): void {
  if (scanScheduled) return;
  scanScheduled = true;
  setTimeout(() => {
    scanScheduled = false;
    void scan();
  }, 250);
}

function findLineElements(): HTMLElement[] {
  for (const selector of LINE_SELECTORS) {
    const matches = [...document.querySelectorAll<HTMLElement>(selector)];
    if (matches.length >= 2) {
      log.debug(`selector "${selector}" matched ${matches.length} lines`);
      return matches;
    }
  }
  return [];
}

// Reads the line's text with our own markup (reading rows, rt readings)
// stripped, so an annotated element compares equal to what we rendered and a
// recycled element compares as fresh text.
function lineText(el: HTMLElement): string {
  if (!el.querySelector(`.${ROW_CLASS}, ruby.kashiyomi-ruby`)) {
    return (el.textContent ?? "").trim();
  }
  const clone = el.cloneNode(true) as HTMLElement;
  for (const node of clone.querySelectorAll(`.${ROW_CLASS}, rt`)) node.remove();
  return (clone.textContent ?? "").trim();
}

// Sudachi rejects inputs over ~48KB; a lyric line should never be near that,
// so anything huge is a sign of something else going wrong.
const MAX_LINE_CHARS = 800;

function isOriginalLyricElement(el: HTMLElement): boolean {
  let sibling = el.previousElementSibling;
  while (sibling) {
    if (sibling.tagName === "P") return false;
    sibling = sibling.previousElementSibling;
  }
  return true;
}

type PendingLine = { el: HTMLElement; original: string };

async function scan(): Promise<void> {
  const settings = getSettings();
  const elements = findLineElements();
  if (elements.length === 0) return;

  const pending: PendingLine[] = [];
  const allTexts: string[] = [];
  for (const el of elements) {
    // NCM renders the translation (译) and its own romanization (音) as
    // additional p siblings after the original line; only the first p in a
    // lyric entry is the lyric itself.
    if (!isOriginalLyricElement(el)) continue;
    // Karaoke word-by-word lines carry per-word spans; not handled yet.
    if (el.querySelector("span:not(rt span)")) continue;
    const text = lineText(el);
    if (text === "" || text.length > MAX_LINE_CHARS) continue;
    allTexts.push(text);
    if (el.getAttribute(MARK_ATTR) === text) continue;
    pending.push({ el, original: text });
  }
  if (pending.length === 0) return;

  const branch = resolveDocumentBranch(allTexts);
  log.debug(`scan: ${pending.length} new lines, document branch: ${branch ?? "none"}`);

  const japanese: { line: PendingLine; displayText: string; hints: ReturnType<typeof projectReadingHints>["hints"] }[] = [];
  const chinese: PendingLine[] = [];
  for (const line of pending) {
    const route = resolveLineRoute(line.original, branch);
    if (route === "japanese") {
      let display = settings.hanRepair ? repairJapaneseHan(line.original) : line.original;
      let hints: ReturnType<typeof projectReadingHints>["hints"] = [];
      if (settings.readingHints) {
        const projection = projectReadingHints(display);
        display = projection.displayText;
        hints = projection.hints;
      }
      japanese.push({ line, displayText: display, hints });
    } else if (route === "chinese" && hasHan(line.original)) {
      chinese.push(line);
    } else {
      line.el.setAttribute(MARK_ATTR, line.original);
    }
  }

  if (japanese.length > 0 && (settings.furigana || settings.romaji)) {
    annotateJapanese(japanese);
  }
  if (chinese.length > 0 && settings.pinyin && assetPaths) {
    await ensurePinyinDict(assetPaths.pinyinDictPath);
    for (const line of chinese) {
      const reading = romanizeMandarin(line.original, {
        tones: settings.pinyinTones,
        joinWords: settings.pinyinJoinWords,
      });
      for (const row of line.el.querySelectorAll(`.${ROW_CLASS}`)) row.remove();
      if (reading !== "") renderPinyinRow(line.el, reading);
      line.el.setAttribute(MARK_ATTR, line.original);
    }
  }
}

function annotateJapanese(
  lines: readonly { line: PendingLine; displayText: string; hints: ReturnType<typeof projectReadingHints>["hints"] }[],
): void {
  const settings = getSettings();
  const result = nativeAnalyze(lines.map((entry) => entry.displayText));
  if (result.kind === "pending") {
    log.debug("analyzer still loading; retrying soon");
    if (pendingRetry === undefined) {
      pendingRetry = window.setTimeout(() => {
        pendingRetry = undefined;
        scheduleScan();
      }, 1500);
    }
    return;
  }
  if (result.kind === "unavailable") {
    log.warn("native analyzer unavailable", result.error ?? "");
    for (const { line } of lines) line.el.setAttribute(MARK_ATTR, line.original);
    return;
  }
  for (let i = 0; i < lines.length; i++) {
    const { line, displayText, hints } = lines[i]!;
    const tokens = result.lines[i] ?? [];
    try {
      const annotation = annotateJapaneseLine(displayText, tokens, hints);
      renderJapaneseLine(line.el, displayText, annotation, {
        furigana: settings.furigana,
        romaji: settings.romaji,
      });
      // After rendering, lineText(el) recovers displayText, so that is the
      // value that must be stored for the annotated-already comparison.
      line.el.setAttribute(MARK_ATTR, displayText);
    } catch (err) {
      // Fail closed: tokens did not match the text; leave the line alone.
      log.debug("annotation failed for line, leaving as-is", displayText, err);
      line.el.setAttribute(MARK_ATTR, line.original);
    }
  }
}
