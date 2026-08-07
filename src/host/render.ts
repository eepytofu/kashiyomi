// DOM rendering for annotated lyric lines. The line element's text is
// replaced with ruby markup; reading rows (romaji or pinyin) are appended as
// small sublines inside the same element so they scroll with the line.

import { panelLang } from "./i18n.ts";
import type { JapaneseLineAnnotation } from "../engine/japanese.ts";

export const MARK_ATTR = "data-kashiyomi";
/**
 * The untouched lyric text a line was annotated from. Kanji repair rewrites
 * the visible text, so without remembering the source we would later read our
 * own repaired output back out of the DOM and treat it as the original.
 */
export const SRC_ATTR = "data-kashiyomi-src";
export const ROW_CLASS = "kashiyomi-row";

// Ideographic space included: lyrics use U+3000 for phrase breaks far more
// often than an ASCII space.
const SPACE_CHAR = /[\s　]/u;

export function renderJapaneseLine(
  el: HTMLElement,
  displayText: string,
  annotation: JapaneseLineAnnotation,
  options: { furigana: boolean; romaji: boolean },
): void {
  el.textContent = "";
  el.setAttribute("lang", "ja");
  let cursor = 0;
  if (options.furigana) {
    for (const segment of annotation.furigana) {
      if (segment.start > cursor) {
        el.appendChild(document.createTextNode(displayText.slice(cursor, segment.start)));
      }
      const ruby = document.createElement("ruby");
      const classes = ["kashiyomi-ruby"];
      if (segment.origin === "authored") classes.push("kashiyomi-authored");
      // A reading wider than its word overhangs on both sides. Two readings
      // only actually collide across a phrase boundary, where the gap is one
      // space wide; back to back with no space they simply sit tight. So the
      // clearance goes on the sides that face a space, and nowhere else —
      // adding it everywhere detaches words that were never in danger.
      if (SPACE_CHAR.test(displayText[segment.start - 1] ?? "")) classes.push("kashiyomi-ruby-gap-start");
      if (SPACE_CHAR.test(displayText[segment.end] ?? "")) classes.push("kashiyomi-ruby-gap-end");
      ruby.className = classes.join(" ");
      ruby.appendChild(document.createTextNode(displayText.slice(segment.start, segment.end)));
      const rt = document.createElement("rt");
      rt.textContent = segment.reading;
      ruby.appendChild(rt);
      el.appendChild(ruby);
      cursor = segment.end;
    }
  }
  if (cursor < displayText.length) {
    el.appendChild(document.createTextNode(displayText.slice(cursor)));
  }
  if (options.romaji && annotation.romaji !== "") {
    el.appendChild(romajiRow(annotation));
  }
}

// Authored (source-provided) readings color their romaji too, matching the
// amber furigana, so both derived layers show the same provenance.
function romajiRow(annotation: JapaneseLineAnnotation): HTMLElement {
  const row = document.createElement("div");
  row.className = ROW_CLASS;
  if (!annotation.romajiSegments.some((segment) => segment.origin === "authored")) {
    row.textContent = annotation.romaji;
    return row;
  }
  for (const segment of annotation.romajiSegments) {
    if (segment.origin === "authored") {
      const span = document.createElement("span");
      span.className = "kashiyomi-authored-romaji";
      span.textContent = segment.text;
      row.appendChild(span);
    } else {
      row.appendChild(document.createTextNode(segment.text));
    }
  }
  return row;
}

/**
 * Say why a Japanese line has no reading, in the place the reading would be.
 *
 * Without this the answer to "I opened the lyrics and there is no furigana" is
 * silence, and the only way to find out is to open settings and guess. This is
 * not a modal or a new surface — it is the row we already inject, carrying a
 * sentence instead of a reading, and it disappears on its own once a dictionary
 * is installed.
 *
 * Rendered once for the whole song rather than per line: sixty copies of the
 * same sentence is not more informative than one, it is just louder.
 */
export function renderNoticeRow(el: HTMLElement, message: string): void {
  const row = document.createElement("div");
  row.className = `${ROW_CLASS} kashiyomi-notice`;
  // Tagged with the panel language, not the song's. Rows are normally tagged
  // from their own text and an untagged one is assumed Latin, which is true of
  // every other row the plugin injects: romaji, pinyin, a translation. This one
  // is the plugin talking, so it is CJK whenever the panel is Chinese, and
  // untagged it inherited the reading-row stack — a Japanese face rendering
  // Simplified Chinese, Han-unified into the wrong glyph forms.
  row.setAttribute("lang", panelLang() === "zh" ? "zh" : "en");
  row.textContent = message;
  el.appendChild(row);
}

export function renderPinyinRow(el: HTMLElement, pinyinText: string): void {
  el.setAttribute("lang", "zh");
  el.appendChild(readingRow(pinyinText));
}

function readingRow(text: string): HTMLElement {
  const row = document.createElement("div");
  row.className = ROW_CLASS;
  row.textContent = text;
  return row;
}

