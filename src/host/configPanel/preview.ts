// The live preview card. Rendered with the production line renderer so the
// panel shows exactly what the lyrics page will.

import { t } from "../i18n.ts";
import { renderJapaneseLine, renderPinyinRow } from "../render.ts";
import { romanizeMandarin } from "../../engine/pinyin.ts";
import { ensurePinyinDict } from "../pinyinDict.ts";
import { resolveAssetPaths } from "../paths.ts";
import { log } from "../log.ts";
import { getSettings } from "../settings.ts";
import { applyStyles } from "../styles.ts";
import { card, sectionTitle } from "./rows.ts";

/**
 * 下等马 (ChiliChill / 洛天依), captured from the app. Every group is a correct
 * split — 在 / 悬崖 / 看 / 红霞 — so "group by word" reads as six syllables
 * becoming four words.
 */
const ZH_SAMPLE = "在悬崖看红霞";

/** Builds the preview card into `column`; returns a refresh function. */
export function buildPreviewCard(column: HTMLElement): () => void {
  column.appendChild(sectionTitle(t("preview")));
  const box = card();
  box.className += " kc-preview";
  column.appendChild(box);

  const refresh = () => {
    const settings = getSettings();
    applyStyles();
    box.textContent = "";

    // Sample annotations are canned so the preview never depends on the
    // native analyzer; classes match the real renderer so global styles
    // (furigana size, authored color) apply identically.
    const hintLine = document.createElement("div");
    hintLine.className = "kc-preview-line";
    renderJapaneseLine(
      hintLine,
      // on:  今=0 宵=1 も=2 天=3 は=4 ␣=5 明=6 る=7 く=8
      settings.readingHints ? "今宵も天は　明るく" : "今宵も天（そら）は　明るく",
      settings.readingHints
        ? {
            furigana: [
              { start: 0, end: 2, reading: "こよい", origin: "inferred" },
              { start: 3, end: 4, reading: "そら", origin: "authored" },
              { start: 6, end: 7, reading: "あか", origin: "inferred" },
            ],
            romaji: "koyoi mo sora wa akaruku",
            romajiSegments: [
              { text: "koyoi mo", origin: "inferred" },
              { text: " sora", origin: "authored" },
              { text: " wa akaruku", origin: "inferred" },
            ],
          }
        : {
            furigana: [
              { start: 0, end: 2, reading: "こよい", origin: "inferred" },
              { start: 3, end: 4, reading: "てん", origin: "inferred" },
              { start: 10, end: 11, reading: "あか", origin: "inferred" },
            ],
            romaji: "koyoi mo ten sora wa akaruku",
            romajiSegments: [{ text: "koyoi mo ten sora wa akaruku", origin: "inferred" }],
          },
      { furigana: settings.furigana, romaji: settings.romaji },
    );

    // Bad Apple!! again, the line after the one above. Kanji repair was the one
    // toggle with no visible effect in this card, because the other two lines
    // carry no glyph NetEase would have damaged.
    const repairLine = document.createElement("div");
    repairLine.className = "kc-preview-line";
    renderJapaneseLine(
      repairLine,
      // 夢/梦=0 見/见=1 て=2 る=3 ␣=4 な=5 に=6 も=7 見/见=8 て=9 な=10 い=11
      settings.hanRepair ? "夢見てる　なにも見てない" : "梦见てる　なにも见てない",
      {
        furigana: [
          { start: 0, end: 2, reading: "ゆめみ", origin: "inferred" },
          { start: 8, end: 9, reading: "み", origin: "inferred" },
        ],
        romaji: "yumemiteru nani mo mitenai",
        romajiSegments: [{ text: "yumemiteru nani mo mitenai", origin: "inferred" }],
      },
      { furigana: settings.furigana, romaji: settings.romaji },
    );

    if (settings.useJpFont && settings.jpFontStack.trim() !== "") {
      hintLine.style.fontFamily = settings.jpFontStack;
      repairLine.style.fontFamily = settings.jpFontStack;
    }
    box.appendChild(hintLine);
    box.appendChild(repairLine);

    const zhLine = document.createElement("div");
    zhLine.className = "kc-preview-line";
    zhLine.textContent = ZH_SAMPLE;
    if (settings.useZhFont && settings.zhFontStack.trim() !== "") {
      zhLine.style.fontFamily = settings.zhFontStack;
    }
    // The line stays even with pinyin off: it is also the only preview of the
    if (settings.pinyin) {
      renderPinyinRow(zhLine, romanizeMandarin(ZH_SAMPLE, {
        tones: settings.pinyinTones,
        joinWords: settings.pinyinJoinWords,
      }));
    }
    box.appendChild(zhLine);
  };
  refresh();
  // Word grouping is invisible without the complete dictionary, so pull it in
  // and redraw once it lands rather than showing a reading that cannot group.
  void resolveAssetPaths()
    .then((paths) => (paths ? ensurePinyinDict(paths.pinyinDictPath) : undefined))
    .then(() => refresh())
    .catch((err) => log.debug("preview could not load the pinyin dictionary", err));
  return refresh;
}
