// DOM rendering for annotated lyric lines. The line element's text is
// replaced with ruby markup; reading rows (romaji or pinyin) are appended as
// small sublines inside the same element so they scroll with the line.

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
  /* Multiplies with NCM's own line colour, which is rgba(255,255,255,0.4) on
     inactive lines and opaque on the active one. At 0.72 that left a reading
     row at 29% on inactive lines. Size still carries the hierarchy. */
  opacity: 0.85;
  line-height: 1.35;
  margin-top: 2px;
}
/* A reading wider than its word overhangs the ruby box and can collide with
   the next reading. Every case ever measured is a **phrase boundary**, where
   the two words are separated by a single space: -6.5px on 千本桜 夜ニ紛レ,
   -5.5px on 此処は宴 鋼の檻, -3.7px on 希望の丘 遥か彼方, all at 75%. 0.2em on
   each facing side clears all of them (min +3.3px).

   It is applied only on sides that face a space. Applying it to every ruby
   also spaced out words with nothing between them -- measured on 無, which has
   no spaced lines at all, removing it entirely left a 0px minimum gap and no
   overlaps, so there the margin bought nothing and only detached 体 from 僕の.

   Do not replace with display:inline-block or inline-table -- both displace
   the reading from its base. */
ruby.kashiyomi-ruby-gap-start {
  margin-inline-start: 0.2em;
}
ruby.kashiyomi-ruby-gap-end {
  margin-inline-end: 0.2em;
}
ruby.kashiyomi-ruby > rt {
  font-size: ${size}%;
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
