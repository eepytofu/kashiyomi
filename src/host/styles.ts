// The stylesheet injected into NCM's page for annotated lines. Split from
// render.ts because the two only share the ROW_CLASS name: one builds DOM per
// line, this one writes a single <style> element from settings.

import { ROW_CLASS } from "./render.ts";
import {
  DEFAULT_ZH_FONT_STACK,
  getSettings,
  MAX_FURIGANA_SIZE,
  MIN_FURIGANA_SIZE,
} from "./settings.ts";

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
  // Clamps here too, not just at the slider: a settings file written before the
  // floor was raised still holds a smaller value.
  const size = Math.min(
    MAX_FURIGANA_SIZE,
    Math.max(MIN_FURIGANA_SIZE, Math.round(settings.furiganaSize)),
  );
  // Rows first, so the [lang] rules below can override them. Both carry
  let fontRule = "";
  if (settings.useRowFont && settings.rowFontStack.trim() !== "") {
    fontRule += `.${ROW_CLASS} { font-family: ${settings.rowFontStack} !important; }\n`;
  }
  if (settings.useJpFont && settings.jpFontStack.trim() !== "") {
    fontRule += `ul.lyric li p[lang="ja"] { font-family: ${settings.jpFontStack} !important; }\n`;
    fontRule += `.${ROW_CLASS}[lang="ja"] { font-family: ${settings.jpFontStack} !important; }\n`;
  }
  if (settings.useZhFont && settings.zhFontStack.trim() !== "") {
    fontRule += `ul.lyric li p[lang="zh"] { font-family: ${settings.zhFontStack} !important; }\n`;
    fontRule += `.${ROW_CLASS}[lang="zh"] { font-family: ${settings.zhFontStack} !important; }\n`;
  }
  // The notice is the plugin's own copy, so it follows the panel language and
  const noticeZh = settings.zhFontStack.trim() === "" ? DEFAULT_ZH_FONT_STACK : settings.zhFontStack;
  fontRule += `.${ROW_CLASS}.kashiyomi-notice[lang="zh"] { font-family: ${noticeZh} !important; }\n`;
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
/* The one row that is not a reading. Italic and dimmer so it reads as the
   plugin talking rather than as part of the song, and it only ever appears
   once per page, on the first line. */
.kashiyomi-notice {
  font-style: italic;
  opacity: 0.55;
}
/**
 * A reading wider than its word overhangs the ruby box and can collide with
 */
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
