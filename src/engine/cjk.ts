// Per-line CJK routing: decide whether a lyric line should get Japanese
// readings, pinyin, or nothing. Document context matters because Han-only
// lines are ambiguous between Chinese and kanji-only Japanese lines, but
// bilingual songs mix both, so a Han-only line that looks Chinese wins over
// the document branch. Pure; no host imports.

import { hasHan, hasKana } from "./kana.ts";

export type CjkDocumentBranch = "japanese" | "chinese" | undefined;
export type CjkLineRoute = "japanese" | "chinese" | undefined;

// Characters that are ordinary Chinese function words and essentially never
// appear in Japanese lyric text.
const CHINESE_MARKERS = new Set(
  [..."的是你她们們这這么麼怎吗嗎呢吧让讓给給说說个咱您哪嘛很什也"],
);

// Chinese word patterns whose characters are individually ambiguous but whose
// pairing is not.
const CHINESE_BIGRAMS = [
  "我不", "不要", "不想", "不是", "不会", "不能", "我的", "你的", "他的", "她的",
  "我们", "我們", "你们", "你們", "他们", "他們", "一个", "一個", "这个", "這個",
  "那个", "那個", "什么", "什麼", "怎么", "怎麼", "因为", "因為", "所以", "可以",
  "已经", "已經", "还是", "還是", "就是", "没有", "沒有", "知道", "时候", "時候",
  "如果", "但是", "只是", "还有", "還有", "多少", "为了", "為了", "一起", "起来",
  "起來", "出来", "出來", "下去", "过去", "過去", "现在", "現在",
];

function chineseSignal(line: string): boolean {
  for (const ch of line) {
    if (CHINESE_MARKERS.has(ch)) return true;
  }
  const compact = line.replace(/\s+/gu, "");
  return CHINESE_BIGRAMS.some((bigram) => compact.includes(bigram));
}

/**
 * Classify the whole lyric document. A couple of kana lines mark the song as
 * Japanese; a clear majority of Han-only lines marks it as Chinese. A small
 * Japanese island must not flip an otherwise Chinese document, so Chinese
 * needs both an absolute floor and a 2:1 advantage.
 */
export function resolveDocumentBranch(lines: readonly string[]): CjkDocumentBranch {
  let kanaLines = 0;
  let hanOnlyLines = 0;
  for (const line of lines) {
    if (hasKana(line)) kanaLines += 1;
    else if (hasHan(line)) hanOnlyLines += 1;
  }
  if (kanaLines === 0 && hanOnlyLines === 0) return undefined;
  if (hanOnlyLines >= 2 && hanOnlyLines >= kanaLines * 2) return "chinese";
  if (kanaLines >= 1) return "japanese";
  return "chinese";
}

/**
 * Route one line given the document context. Kana in the line forces
 * Japanese. A Han-only line that carries Chinese function words is Chinese
 * even inside a Japanese song (bilingual lyrics are common); otherwise it
 * follows the document branch.
 */
export function resolveLineRoute(line: string, doc: CjkDocumentBranch): CjkLineRoute {
  const kana = hasKana(line);
  const han = hasHan(line);
  if (!kana && !han) return undefined;
  if (kana) return "japanese";
  if (chineseSignal(line)) return "chinese";
  return doc ?? "chinese";
}
