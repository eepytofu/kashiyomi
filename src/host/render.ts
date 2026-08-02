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
    el.appendChild(readingRow(annotation.romaji));
  }
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

export function injectStyles(): void {
  if (document.getElementById("kashiyomi-style")) return;
  const style = document.createElement("style");
  style.id = "kashiyomi-style";
  style.textContent = `
.${ROW_CLASS} {
  font-size: 0.72em;
  opacity: 0.72;
  line-height: 1.35;
  margin-top: 2px;
}
ruby.kashiyomi-ruby > rt {
  font-size: 0.5em;
  opacity: 0.85;
  user-select: none;
}
ruby.kashiyomi-authored > rt {
  color: rgb(255, 207, 128);
}
`;
  document.head.appendChild(style);
}
