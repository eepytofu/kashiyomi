// DOM rendering for annotated lyric lines. The line element's text is
// replaced with ruby markup; reading rows (romaji or pinyin) are appended as
// small sublines inside the same element so they scroll with the line.

import type { JapaneseLineAnnotation } from "../engine/japanese.ts";

export const MARK_ATTR = "data-kashiyomi";
export const ROW_CLASS = "kashiyomi-row";

export function renderJapaneseLine(
  el: HTMLElement,
  displayText: string,
  annotation: JapaneseLineAnnotation,
  options: { furigana: boolean; romaji: boolean },
): void {
  el.textContent = "";
  el.setAttribute("lang", "ja");
  let cursor = 0;
  if (options.furigana && annotation.furigana.length > 0) {
    // Marks the line so CSS reserves headroom for the overlay readings.
    el.classList.add("kashiyomi-has-ruby");
  }
  if (options.furigana) {
    for (const segment of annotation.furigana) {
      if (segment.start > cursor) {
        el.appendChild(document.createTextNode(displayText.slice(cursor, segment.start)));
      }
      const ruby = document.createElement("ruby");
      ruby.className = segment.origin === "authored" ? "kashiyomi-ruby kashiyomi-authored" : "kashiyomi-ruby";
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

import { getSettings } from "./settings.ts";

/**
 * (Re)build the injected stylesheet from current settings. Cheap; call after
 * any settings change instead of tracking which ones affect styling.
 */
export function applyStyles(): void {
  const settings = getSettings();
  let style = document.getElementById("kashiyomi-style") as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = "kashiyomi-style";
    document.head.appendChild(style);
  }
  const size = Math.min(100, Math.max(10, Math.round(settings.furiganaSize)));
  // Headroom above lines that carry readings; scales with the rt size.
  const headroom = ((size / 100) * 1.25).toFixed(2);
  let fontRule = "";
  if (settings.useJpFont && settings.jpFontStack.trim() !== "") {
    fontRule += `ul.lyric li p[lang="ja"] { font-family: ${settings.jpFontStack} !important; }\n`;
  }
  if (settings.useZhFont && settings.zhFontStack.trim() !== "") {
    fontRule += `ul.lyric li p[lang="zh"] { font-family: ${settings.zhFontStack} !important; }\n`;
  }
  style.textContent = `
.${ROW_CLASS} {
  font-size: 0.72em;
  opacity: 0.72;
  line-height: 1.35;
  margin-top: 2px;
}
/* Readings overlay the line instead of using native ruby layout, which
   spreads base characters apart whenever the reading is wider than its
   kanji (and CEF 91 has no ruby-align to control it). */
.kashiyomi-has-ruby {
  padding-top: ${headroom}em;
}
ruby.kashiyomi-ruby {
  display: inline-block;
  position: relative;
}
ruby.kashiyomi-ruby > rt {
  position: absolute;
  left: 50%;
  top: 0;
  transform: translate(-50%, -100%);
  font-size: ${size}%;
  line-height: 1.15;
  white-space: nowrap;
  user-select: none;
}
ruby.kashiyomi-authored > rt {
  color: rgb(255, 207, 128);
}
.${ROW_CLASS} .kashiyomi-authored-romaji {
  color: rgba(255, 207, 128, 0.9);
}
${fontRule}
`;
}
