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
 *
 * The previous sample, 无可奈何花落去, was one dictionary entry, so grouping
 * rendered a single seven-syllable run and made a working setting look broken.
 * Any replacement needs several groups that are each a real multi-syllable
 * word, and no chengyu, neutral tone or 一/不 sandhi.
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
    //
    // Every line is a real lyric captured from the app, and every annotation was
    // produced by running the real engine over the real Sudachi tokens.
    // **Regenerate rather than edit**: analyze the line, feed the tokens to
    // `annotateJapaneseLine`, paste what it returns. Hand-editing has been wrong
    // twice — once claiming a ゆめみ ruby the tokenizer did not produce, once a
    // 何も where the song writes なにも.
    //
    // A third line, 語るも無駄な　自分の言葉, was removed once the repair line
    // below existed: it exercised furigana, romaji, size and the Japanese font,
    // all of which the repair line also exercises, so it demonstrated nothing of
    // its own. Its one unique job — showing the ideographic space — moved with
    // it, which is why the line below is spaced 夢見てる　なにも見てない.
    //
    // アマツキツネ, captured from the app: the lyric is written
    // 今宵も天（そら）は　明るく. On, the annotation is consumed and そら becomes
    // the reading; off, the line stays exactly as NetEase serves it, brackets
    // included, and 天 falls back to the dictionary's てん.
    const hintLine = document.createElement("div");
    hintLine.className = "kc-preview-line";
    renderJapaneseLine(
      hintLine,
      // on:  今=0 宵=1 も=2 天=3 は=4 ␣=5 明=6 る=7 く=8
      // off: 今=0 宵=1 も=2 天=3 （=4 そ=5 ら=6 ）=7 は=8 ␣=9 明=10 る=11 く=12
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
    //
    // **One annotation serves both states.** The setting chooses what is shown,
    // not what is analysed, so the readings are identical either way — which is
    // the whole point of the fix and is exactly what this line demonstrates.
    // Before it, repair off handed the analyzer 梦见 and the ruby vanished.
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
    // Chinese font setting, which is independent of pinyin. The Japanese lines
    // behave the same way — with furigana and romaji off they render as plain
    // text rather than disappearing.
    //
    // Romanized by the production function, not a canned string. A canned one
    // was wrong once already: it hardcoded a grouping the segmenter does not
    // produce. Word grouping needs the complete dictionary, which is loaded on
    // demand — until it arrives the preview shows the ungrouped reading, then
    // refreshes.
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
  //
  // Resolved here rather than read from `currentAssetPaths()`, which is only
  // populated once `startAnnotator` runs. BetterNCM builds this panel at plugin
  // load, inside the ~700ms `start()` spends awaiting the paths, so that getter
  // returned undefined, the request was skipped, and nothing ever retried:
  // "group pinyin by word" then did nothing in the preview for the whole
  // session, whatever the toggle said.
  void resolveAssetPaths()
    .then((paths) => (paths ? ensurePinyinDict(paths.pinyinDictPath) : undefined))
    .then(() => refresh())
    .catch((err) => log.debug("preview could not load the pinyin dictionary", err));
  return refresh;
}
