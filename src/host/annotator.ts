// Watches NCM's lyric DOM and annotates lines in place. Lines are matched by
// their text content, not by class names, so NCM markup churn degrades to
// "no annotation" instead of breaking. Elements NCM recycles are detected by
// comparing the stored original text and re-annotated.

import {
  resolveDocumentContext,
  resolveLineRoute,
  type LineTranslationState,
} from "../engine/cjk.ts";
import { repairJapaneseHan } from "../engine/hanRepair.ts";
import { projectReadingHints } from "../engine/hints.ts";
import { annotateJapaneseLine, type JapaneseLineAnnotation } from "../engine/japanese.ts";
import { romanizeMandarin } from "../engine/pinyin.ts";
import { hasHan, hasKana, kataToHira, usesKatakanaOkurigana } from "../engine/kana.ts";
import { isCreditLine } from "../engine/metadata.ts";
import { shouldDisplayTranslation } from "../engine/aiTranslation.ts";
import { nativeAnalyze } from "./native.ts";
import { translateSong, translationConfigured } from "./translator.ts";
import { ensurePinyinDict } from "./pinyinDict.ts";
import { MARK_ATTR, ROW_CLASS, SRC_ATTR, renderJapaneseLine, renderPinyinRow } from "./render.ts";
import { getSettings } from "./settings.ts";
import { log } from "./log.ts";
import { diagnoseLayout } from "./diagnose.ts";
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

/**
 * Drop our annotations and analyze every line again.
 *
 * The visible text is put back to the lyric NetEase supplied before the
 * bookkeeping is cleared. Kanji repair rewrites what is on screen (繼續 →
 * 継続), and the untouched original only exists in SRC_ATTR, so clearing that
 * attribute while leaving the repaired text in place would make the next scan
 * read our own output as if it were the source — the one thing routing must
 * never do. A line misrouted once would then stay misrouted no matter how the
 * detector improves.
 */
export function rescan(): void {
  for (const el of document.querySelectorAll<HTMLElement>(`[${MARK_ATTR}]`)) {
    const source = el.getAttribute(SRC_ATTR);
    // Only restore when the element still shows what we rendered. If NetEase
    // has since replaced the line, its own text is already there and is newer
    // than anything we remembered.
    if (source !== null && renderedText(el) === el.getAttribute(MARK_ATTR)) {
      el.textContent = source;
    }
    el.removeAttribute(MARK_ATTR);
    el.removeAttribute(SRC_ATTR);
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
function renderedText(el: HTMLElement): string {
  if (!el.querySelector(`.${ROW_CLASS}, ruby.kashiyomi-ruby`)) {
    return (el.textContent ?? "").trim();
  }
  const clone = el.cloneNode(true) as HTMLElement;
  for (const node of clone.querySelectorAll(`.${ROW_CLASS}, rt`)) node.remove();
  return (clone.textContent ?? "").trim();
}

/**
 * The lyric text as NCM provided it. For an element we already annotated,
 * that is the remembered source rather than what is now on screen, because
 * kanji repair may have rewritten the visible characters. Reading the
 * repaired text back would let one misrouted line permanently change how the
 * line is classified.
 */
function sourceText(el: HTMLElement): string {
  const rendered = renderedText(el);
  const remembered = el.getAttribute(SRC_ATTR);
  if (remembered !== null && el.getAttribute(MARK_ATTR) === rendered) return remembered;
  return rendered;
}

/**
 * Record that a line has been handled: what is on screen now, and the source
 * it came from.
 */
function markAnnotated(el: HTMLElement, source: string, rendered = source): void {
  el.setAttribute(MARK_ATTR, rendered);
  el.setAttribute(SRC_ATTR, source);
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

// ---- analysis cache ----------------------------------------------------

// Analysis is deterministic for a given display text, and NCM recycles line
// elements constantly while scrolling, so the same lines would otherwise be
// re-analyzed many times per song. An in-memory map is enough: the expensive
// part is the one-off dictionary load, not tokenizing a line, and keeping
// this out of storage avoids competing with the translation cache for quota
// and avoids stale results when the dictionary or engine changes.
const ANALYSIS_CACHE_CAP = 600;
const analysisCache = new Map<string, JapaneseLineAnnotation>();

function cachedAnnotation(text: string): JapaneseLineAnnotation | undefined {
  const hit = analysisCache.get(text);
  if (hit) {
    // Refresh insertion order so active songs survive eviction.
    analysisCache.delete(text);
    analysisCache.set(text, hit);
  }
  return hit;
}

function rememberAnnotation(text: string, annotation: JapaneseLineAnnotation): void {
  analysisCache.set(text, annotation);
  while (analysisCache.size > ANALYSIS_CACHE_CAP) {
    const oldest = analysisCache.keys().next();
    if (oldest.done) break;
    analysisCache.delete(oldest.value);
  }
}

// Layout is dumped once per session, after the first line that actually
// carries ruby, so the log shows how NCM lays annotated lines out. The dump is
// deferred: the ruby has just been inserted, and if the lyric panel is not
// laid out yet every width comes back zero. diagnoseLayout reports whether it
// got usable numbers, and we re-arm a bounded number of times if it did not.
let layoutDiagnosed = false;
let layoutAttempts = 0;
const LAYOUT_ATTEMPT_CAP = 5;

function scheduleLayoutDiagnosis(): void {
  if (!getSettings().debug) return;
  if (layoutDiagnosed || layoutAttempts >= LAYOUT_ATTEMPT_CAP) return;
  layoutDiagnosed = true;
  layoutAttempts++;
  window.setTimeout(() => {
    if (!diagnoseLayout()) layoutDiagnosed = false;
  }, 600);
}

/** Drop cached analysis (settings that change readings invalidate it). */
export function resetAnalysisCache(): void {
  analysisCache.clear();
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

/**
 * Whether NetEase is showing its own Chinese translation for this line.
 * Only meaningful when the song carries translations at all, which the
 * document context decides.
 */
function translationStateFor(el: HTMLElement): LineTranslationState {
  return hasProviderTranslationSibling(el) ? "translated" : "untranslated";
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

type PendingLine = { el: HTMLElement; original: string; translation: LineTranslationState };

type JapaneseWork = {
  line: PendingLine;
  /** Text shown on screen, after repair and hint removal. */
  displayText: string;
  /** Same length as displayText, adjusted so the analyzer can parse it. */
  analysisText: string;
  hints: ReturnType<typeof projectReadingHints>["hints"];
};

async function scan(): Promise<void> {
  const settings = getSettings();
  const elements = findLineElements();
  if (elements.length === 0) return;

  const pending: PendingLine[] = [];
  const allTexts: string[] = [];
  const translationStates: LineTranslationState[] = [];
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
    const text = sourceText(el);
    if (text === "" || text.length > MAX_LINE_CHARS) continue;
    // Production credits (作詞: …, 编曲：…) are not lyrics. They are never
    // translated, and only annotated when the user asks for it.
    const credit = isCreditLine(text);
    if (!credit) {
      allTexts.push(text);
      originals.push({ el, text });
      translationStates.push(translationStateFor(el));
    }
    if (credit && !settings.annotateCredits) {
      markAnnotated(el, text);
      continue;
    }
    if (el.getAttribute(SRC_ATTR) === text && el.hasAttribute(MARK_ATTR)) continue;
    pending.push({ el, original: text, translation: translationStateFor(el) });
  }

  if (pending.length === 0) {
    // Steady state: every visible line is annotated. Attach (and, when
    // enabled, request) AI translations now so they never race annotation.
    maybeTranslate(originals);
    return;
  }

  const docContext = resolveDocumentContext(allTexts, translationStates);
  log.debug(
    `scan: ${pending.length} new lines, document branch: ${docContext.branch ?? "none"}` +
      (docContext.bilingual ? " (bilingual)" : ""),
  );

  const japanese: JapaneseWork[] = [];
  const chinese: PendingLine[] = [];
  for (const line of pending) {
    const route = resolveLineRoute(line.original, docContext, line.translation);
    if (route === "japanese") {
      line.el.setAttribute("lang", "ja");
      let display = settings.hanRepair ? repairJapaneseHan(line.original) : line.original;
      let hints: ReturnType<typeof projectReadingHints>["hints"] = [];
      if (settings.readingHints) {
        const projection = projectReadingHints(display);
        display = projection.displayText;
        hints = projection.hints;
      }
      // Katakana-okurigana lines are analyzed as hiragana; the conversion is
      // one character to one, so offsets still match what is displayed.
      const analysisText = usesKatakanaOkurigana(display) ? kataToHira(display) : display;
      japanese.push({ line, displayText: display, analysisText, hints });
    } else if (route === "chinese" && hasHan(line.original)) {
      line.el.setAttribute("lang", "zh");
      chinese.push(line);
    } else {
      markAnnotated(line.el, line.original);
    }
  }

  // Han-only lines routed to Japanese are the cases most likely to be wrong,
  // so name them in the log to make misrouting diagnosable.
  if (settings.debug) {
    const hanOnlyJapanese = japanese
      .filter((entry) => !hasKana(entry.line.original))
      .map((entry) => entry.line.original);
    if (hanOnlyJapanese.length > 0) {
      log.debug(`han-only lines routed japanese: ${JSON.stringify(hanOnlyJapanese)}`);
    }
    if (chinese.length > 0) {
      log.debug(`lines routed chinese: ${JSON.stringify(chinese.map((l) => l.original))}`);
    }
  }

  if (japanese.length > 0 && (settings.furigana || settings.romaji)) {
    annotateJapanese(japanese);
  } else {
    for (const { line } of japanese) markAnnotated(line.el, line.original);
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
        markAnnotated(line.el, line.original);
      }
    } else {
      for (const line of chinese) markAnnotated(line.el, line.original);
    }
  }
  // Something was annotated this pass; the observer will fire again and the
  // steady-state pass above will handle translations.
}

function annotateJapanese(
  lines: readonly JapaneseWork[],
): void {
  const settings = getSettings();

  // Render anything already analyzed, and only ask the backend for the rest.
  const pendingAnalysis: JapaneseWork[] = [];
  for (const entry of lines) {
    const hit = cachedAnnotation(entry.displayText);
    if (hit) {
      applyAnnotation(entry.line, entry.displayText, hit, settings);
    } else {
      pendingAnalysis.push(entry);
    }
  }
  if (pendingAnalysis.length === 0) return;

  const result = nativeAnalyze(pendingAnalysis.map((entry) => entry.analysisText));
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
    for (const { line } of pendingAnalysis) {
      markAnnotated(line.el, line.original);
    }
    return;
  }
  log.debug(`analyzed ${pendingAnalysis.length} lines (${lines.length - pendingAnalysis.length} cached)`);
  for (let i = 0; i < pendingAnalysis.length; i++) {
    const { line, displayText, analysisText, hints } = pendingAnalysis[i]!;
    const tokens = result.lines[i] ?? [];
    try {
      const annotation = annotateJapaneseLine(analysisText, tokens, hints);
      // Hints come from the line itself, so the annotation is a pure function
      // of the display text and safe to reuse.
      rememberAnnotation(displayText, annotation);
      applyAnnotation(line, displayText, annotation, settings);
    } catch (err) {
      // Fail closed: tokens did not match the text; leave the line alone.
      log.debug("annotation failed for line, leaving as-is", displayText, err);
      markAnnotated(line.el, line.original);
    }
  }
}

function applyAnnotation(
  line: PendingLine,
  displayText: string,
  annotation: JapaneseLineAnnotation,
  settings: ReturnType<typeof getSettings>,
): void {
  renderJapaneseLine(line.el, displayText, annotation, {
    furigana: settings.furigana,
    romaji: settings.romaji,
  });
  // renderedText(el) now recovers displayText, so that is the marker; the
  // untouched source is kept separately for routing on later scans.
  markAnnotated(line.el, line.original, displayText);
  if (line.el.querySelector("ruby.kashiyomi-ruby")) scheduleLayoutDiagnosis();
}
