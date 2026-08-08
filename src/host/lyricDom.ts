// Everything that knows the shape of NCM's lyric DOM: how to find lines, how
// to read the text a line came from, how to record that we handled it, and
// how to see the player's own translation row.

import type { CjkDocumentBranch, LineTranslationState } from "../engine/cjk.ts";
import { hasHan, hasKana } from "../engine/kana.ts";
import { scriptForFont, type ScriptLang } from "../engine/scriptLang.ts";
import { MARK_ATTR, ROW_CLASS, SRC_ATTR } from "./render.ts";
import { log } from "./log.ts";

// NCM 3.x native lyric lines. Kept deliberately short; findLineElements logs
// candidate counts so new selectors can be added from live debugging.
const LINE_SELECTORS = [
  "ul.lyric li p",
  'ul[class*="lyric"] li p',
  ".lyric-scroll p",
];

export function findLineElements(): HTMLElement[] {
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
export function renderedText(el: HTMLElement): string {
  if (!el.querySelector(`.${ROW_CLASS}, ruby.kashiyomi-ruby`)) {
    return (el.textContent ?? "").trim();
  }
  const clone = el.cloneNode(true) as HTMLElement;
  for (const node of clone.querySelectorAll(`.${ROW_CLASS}, rt`)) node.remove();
  return (clone.textContent ?? "").trim();
}

/**
 * The lyric text as NCM provided it. For an element we already annotated,
 */
export function sourceText(el: HTMLElement): string {
  const rendered = renderedText(el);
  const remembered = el.getAttribute(SRC_ATTR);
  if (remembered !== null && el.getAttribute(MARK_ATTR) === rendered) return remembered;
  return rendered;
}

/**
 * Record that a line has been handled: what is on screen now, and the source
 * it came from.
 */
export function markAnnotated(el: HTMLElement, source: string, rendered = source): void {
  el.setAttribute(MARK_ATTR, rendered);
  el.setAttribute(SRC_ATTR, source);
}

/** True when the line is already annotated from exactly this source text. */
export function isAnnotatedFrom(el: HTMLElement, source: string): boolean {
  return el.getAttribute(SRC_ATTR) === source && el.hasAttribute(MARK_ATTR);
}

/**
 * Undo every annotation on the page, putting the lyric NetEase supplied back
 * on screen first.
 */
export function clearAnnotations(): void {
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
}

/**
 * Only the first `<p>` in a lyric entry is the lyric. NCM renders its
 * translation (译) and its own romanization (音) as additional `<p>` siblings
 * after it.
 */
export function isOriginalLyricElement(el: HTMLElement): boolean {
  let sibling = el.previousElementSibling;
  while (sibling) {
    if (sibling.tagName === "P") return false;
    sibling = sibling.previousElementSibling;
  }
  return true;
}

/**
 * Tag a line we are not going to annotate with the script it is written in, so
 * the Japanese/Chinese font settings still reach it. Routing normally does
 * this; lines we skip never get routed.
 */
export function applyScriptFont(
  el: HTMLElement,
  text: string,
  branch?: CjkDocumentBranch,
): void {
  const lang = scriptForFont(text, branchScript(branch));
  if (lang !== undefined) el.setAttribute("lang", lang);
}

/** The routing branch as a font tag. Two vocabularies for the same two languages. */
function branchScript(branch: CjkDocumentBranch): ScriptLang {
  if (branch === "japanese") return "ja";
  if (branch === "chinese") return "zh";
  return undefined;
}

export function hasProviderTranslationSibling(el: HTMLElement): boolean {
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
export function translationStateFor(el: HTMLElement): LineTranslationState {
  return hasProviderTranslationSibling(el) ? "translated" : "untranslated";
}
