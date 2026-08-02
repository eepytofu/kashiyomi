// Watches NCM's lyric DOM and annotates lines in place. Lines are matched by
// their text content, not by class names, so NCM markup churn degrades to
// "no annotation" instead of breaking. Elements NCM recycles are detected by
// comparing the stored original text and re-annotated.

import { resolveDocumentBranch, resolveLineRoute } from "../engine/cjk.ts";
import { repairJapaneseHan } from "../engine/hanRepair.ts";
import { projectReadingHints } from "../engine/hints.ts";
import { annotateJapaneseLine } from "../engine/japanese.ts";
import { romanizeMandarin } from "../engine/pinyin.ts";
import { hasHan, hasKana } from "../engine/kana.ts";
import { isCreditLine } from "../engine/metadata.ts";
import { shouldDisplayTranslation } from "../engine/aiTranslation.ts";
import { nativeAnalyze } from "./native.ts";
import { translateSong, translationConfigured } from "./translator.ts";
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

// ---- AI translation ----------------------------------------------------

let txAbort: AbortController | undefined;
let txDocKey = "";
const txByText = new Map<string, string>();

/** Forget the current song's translation state (call when AI settings change). */
export function resetTranslation(): void {
  txAbort?.abort();
  txAbort = undefined;
  txDocKey = "";
  txByText.clear();
}

function hasProviderTranslationSibling(el: HTMLElement): boolean {
  let sibling = el.nextElementSibling;
  while (sibling) {
    if (sibling.tagName === "P") {
      const text = (sibling.textContent ?? "").trim();
      if (hasHan(text) && !hasKana(text)) return true;
    }
    sibling = sibling.nextElementSibling;
  }
  return false;
}

function attachTranslationRows(originals: readonly { el: HTMLElement; text: string }[]): void {
  if (txByText.size === 0) return;
  for (const { el, text } of originals) {
    const translated = txByText.get(text);
    if (!translated) continue;
    if (el.querySelector(".kashiyomi-tx")) continue;
    // NCM's own translation (tlyric) outranks the AI lane; never double up.
    if (hasProviderTranslationSibling(el)) continue;
    const row = document.createElement("div");
    row.className = `${ROW_CLASS} kashiyomi-tx`;
    row.textContent = translated;
    el.appendChild(row);
  }
}

function maybeTranslate(originals: readonly { el: HTMLElement; text: string }[]): void {
  attachTranslationRows(originals);
  const settings = getSettings();
  if (!settings.aiAutoTranslate || !translationConfigured()) return;
  if (originals.length < 2) return;
  const texts = originals.map((entry) => entry.text);
  const docKey = texts.join("\n");
  if (docKey === txDocKey) return; // already translated, in flight, or failed once
  txDocKey = docKey;
  txAbort?.abort();
  const controller = new AbortController();
  txAbort = controller;
  void (async () => {
    const translated = await translateSong(texts, {}, controller.signal);
    if (!translated || controller.signal.aborted) return;
    txByText.clear();
    for (let i = 0; i < texts.length; i++) {
      const source = texts[i]!;
      const target = translated[i] ?? "";
      if (shouldDisplayTranslation(source, target)) txByText.set(source, target);
    }
    log.info(`translation ready for ${txByText.size} lines`);
    scheduleScan();
  })();
}

type PendingLine = { el: HTMLElement; original: string };

async function scan(): Promise<void> {
  const settings = getSettings();
  const elements = findLineElements();
  if (elements.length === 0) return;

  const pending: PendingLine[] = [];
  const allTexts: string[] = [];
  const originals: { el: HTMLElement; text: string }[] = [];
  for (const el of elements) {
    // NCM renders the translation (译) and its own romanization (音) as
    // additional p siblings after the original line; only the first p in a
    // lyric entry is the lyric itself. Chinese translation siblings still get
    // a lang tag so the Chinese font setting can reach them.
    if (!isOriginalLyricElement(el)) {
      const siblingText = (el.textContent ?? "").trim();
      if (hasHan(siblingText) && !hasKana(siblingText)) el.setAttribute("lang", "zh");
      continue;
    }
    // Karaoke word-by-word lines carry per-word spans; not handled yet.
    if (el.querySelector("span:not(rt span)")) continue;
    const text = lineText(el);
    if (text === "" || text.length > MAX_LINE_CHARS) continue;
    // Production credits (作詞: …, 编曲：…) are not lyrics. They are never
    // translated, and only annotated when the user asks for it.
    const credit = isCreditLine(text);
    if (!credit) {
      allTexts.push(text);
      originals.push({ el, text });
    }
    if (credit && !settings.annotateCredits) {
      el.setAttribute(MARK_ATTR, text);
      continue;
    }
    if (el.getAttribute(MARK_ATTR) === text) continue;
    pending.push({ el, original: text });
  }

  if (pending.length === 0) {
    // Steady state: every visible line is annotated. Attach (and, when
    // enabled, request) AI translations now so they never race annotation.
    maybeTranslate(originals);
    return;
  }

  const branch = resolveDocumentBranch(allTexts);
  log.debug(`scan: ${pending.length} new lines, document branch: ${branch ?? "none"}`);

  const japanese: { line: PendingLine; displayText: string; hints: ReturnType<typeof projectReadingHints>["hints"] }[] = [];
  const chinese: PendingLine[] = [];
  for (const line of pending) {
    const route = resolveLineRoute(line.original, branch);
    if (route === "japanese") {
      line.el.setAttribute("lang", "ja");
      let display = settings.hanRepair ? repairJapaneseHan(line.original) : line.original;
      let hints: ReturnType<typeof projectReadingHints>["hints"] = [];
      if (settings.readingHints) {
        const projection = projectReadingHints(display);
        display = projection.displayText;
        hints = projection.hints;
      }
      japanese.push({ line, displayText: display, hints });
    } else if (route === "chinese" && hasHan(line.original)) {
      line.el.setAttribute("lang", "zh");
      chinese.push(line);
    } else {
      line.el.setAttribute(MARK_ATTR, line.original);
    }
  }

  if (japanese.length > 0 && (settings.furigana || settings.romaji)) {
    annotateJapanese(japanese);
  } else {
    for (const { line } of japanese) line.el.setAttribute(MARK_ATTR, line.original);
  }
  if (chinese.length > 0) {
    if (settings.pinyin && assetPaths) {
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
    } else {
      for (const line of chinese) line.el.setAttribute(MARK_ATTR, line.original);
    }
  }
  // Something was annotated this pass; the observer will fire again and the
  // steady-state pass above will handle translations.
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
