// The stylesheet injected into NCM's page for annotated lines. Split from
// render.ts because the two only share the ROW_CLASS name: one builds DOM per
// line, this one writes a single <style> element from settings.

import { ROW_CLASS } from "./render.ts";
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
