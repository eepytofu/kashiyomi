// Watches NCM's lyric DOM and annotates lines in place: classify each line,
// route it to Japanese or Chinese, then hand it to the matching renderer.
// Everything that knows NCM's markup lives in lyricDom.ts.

import {
  resolveDocumentContext,
  resolveLineRoute,
  type LineTranslationState,
} from "../engine/cjk.ts";
import { annotateJapaneseLine, type JapaneseLineAnnotation } from "../engine/japanese.ts";
import { applyJmdictReadings, type JmdictReadings } from "../engine/jmdictReadings.ts";
import { ensureJmdictReadings } from "./jmdictDict.ts";
import { romanizeMandarin } from "../engine/pinyin.ts";
import { hasHan, hasKana } from "../engine/kana.ts";
import { classifyLines, type ClassifiableLine } from "../engine/lineKinds.ts";
import { prepareJapaneseLine, type PreparedJapaneseLine } from "../engine/lineText.ts";
import { nativeAnalyze } from "./native.ts";
import { ensurePinyinDict } from "./pinyinDict.ts";
import { ROW_CLASS, renderJapaneseLine, renderPinyinRow } from "./render.ts";
import {
  applyScriptFont,
  clearAnnotations,
  findLineElements,
  isAnnotatedFrom,
  isOriginalLyricElement,
  markAnnotated,
  sourceText,
  translationStateFor,
} from "./lyricDom.ts";
import { cachedAnnotation, rememberAnnotation } from "./analysisCache.ts";
import { maybeTranslate, type OriginalLine } from "./translationLane.ts";
import { getSettings } from "./settings.ts";
import { log } from "./log.ts";
import type { AssetPaths } from "./paths.ts";

let assetPaths: AssetPaths | undefined;
let observer: MutationObserver | undefined;
let scanScheduled = false;
let pendingRetry: number | undefined;

/** Where the on-disk assets are, for panels that need one loaded on demand. */
export function currentAssetPaths(): AssetPaths | undefined {
  return assetPaths;
}

export function startAnnotator(paths: AssetPaths): void {
  assetPaths = paths;
  observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  scheduleScan();
  log.info("annotator started");
}

/** Drop our annotations and analyze every line again. */
export function rescan(): void {
  clearAnnotations();
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

// Sudachi rejects inputs over ~48KB; a lyric line should never be near that,
// so anything huge is a sign of something else going wrong.
const MAX_LINE_CHARS = 800;

type PendingLine = { el: HTMLElement; original: string; translation: LineTranslationState };

type JapaneseWork = PreparedJapaneseLine & { line: PendingLine };

async function scan(): Promise<void> {
  const settings = getSettings();
  const elements = findLineElements();
  if (elements.length === 0) return;

  // First pass collects the lyric elements. What each line *is* cannot be
  // decided yet: classifyLines needs the whole song, because two of its
  // signals are document-level.
  const scanned: (ClassifiableLine & { el: HTMLElement })[] = [];
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
    const text = sourceText(el);
    if (text === "" || text.length > MAX_LINE_CHARS) continue;
    scanned.push({ el, text, translation: translationStateFor(el) });
  }

  const kinds = classifyLines(scanned);

  const pending: PendingLine[] = [];
  // Lines we will not annotate but must still give a font to. They cannot be
  // labelled here: the document branch is the fallback for a line with no
  // script of its own, and it is not known until `allTexts` below is complete.
  // Labelling them in this loop is why 【KBShinya 】 kept NCM's default stack
  // while 【哦漏】 two lines above it did not — same song, same kind of line.
  const unrouted: OriginalLine[] = [];
  const allTexts: string[] = [];
  const translationStates: LineTranslationState[] = [];
  const originals: OriginalLine[] = [];
  for (const [index, line] of scanned.entries()) {
    const { el, text } = line;
    const kind = kinds[index]!;
    // Markers are never annotated, whatever the credits setting says.
    if (kind === "marker") {
      unrouted.push({ el, text });
      continue;
    }
    if (kind === "lyric") {
      allTexts.push(text);
      originals.push({ el, text });
      translationStates.push(line.translation);
    } else if (!settings.annotateCredits) {
      unrouted.push({ el, text });
      continue;
    }
    if (isAnnotatedFrom(el, text)) continue;
    pending.push({ el, original: text, translation: line.translation });
  }

  if (pending.length === 0 && unrouted.length === 0) {
    // Steady state: every visible line is annotated. Attach (and, when
    // enabled, request) AI translations now so they never race annotation.
    maybeTranslate(originals, scheduleScan);
    return;
  }

  const docContext = resolveDocumentContext(allTexts, translationStates);
  log.debug(
    `scan: ${pending.length} new lines, document branch: ${docContext.branch ?? "none"}` +
      (docContext.bilingual ? " (bilingual)" : ""),
  );

  for (const line of unrouted) {
    applyScriptFont(line.el, line.text, docContext.branch);
    markAnnotated(line.el, line.text);
  }

  const japanese: JapaneseWork[] = [];
  const chinese: PendingLine[] = [];
  for (const line of pending) {
    const route = resolveLineRoute(line.original, docContext, line.translation);
    if (route === "japanese") {
      line.el.setAttribute("lang", "ja");
      japanese.push({ line, ...prepareJapaneseLine(line.original, settings) });
    } else if (route === "chinese" && hasHan(line.original)) {
      line.el.setAttribute("lang", "zh");
      chinese.push(line);
    } else {
      // A line with no script of its own — "-interlude-" in 無 — still needs a
      // font, or it keeps NCM's default stack, which leads with 微软雅黑: a
      // Chinese sans rendering Latin text in a song set in a Japanese serif.
      // applyScriptFont cannot help, because it reads the line's own script and
      // finds none; the document's branch is the only signal there is. Left
      // unset when the document branch is undecided, which is the honest answer
      // for a line that could belong to either.
      if (docContext.branch === "japanese") line.el.setAttribute("lang", "ja");
      else if (docContext.branch === "chinese") line.el.setAttribute("lang", "zh");
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
    // Loaded before annotating rather than during: the annotation cache keys on
    // display text, so a line annotated before the asset arrived would be
    // remembered without its readings and never revisited.
    const jmdict = assetPaths ? await ensureJmdictReadings(assetPaths.jmdictPath) : undefined;
    annotateJapanese(japanese, jmdict);
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
  jmdict: JmdictReadings | undefined,
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
    const raw = result.lines[i] ?? [];
    // Fills readings the analyzer abstained on (磊々 → ライライ). Never
    // overrides one it produced, so this cannot change an existing annotation.
    const tokens = jmdict ? applyJmdictReadings(raw, jmdict) : raw;
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
}
