// Per-line CJK routing: decide whether a lyric line should get Japanese
// readings, pinyin, or nothing. Document context matters because Han-only
// lines are ambiguous between Chinese and kanji-only Japanese lines, but
// bilingual songs mix both, so a Han-only line that looks Chinese wins over
// the document branch. Pure; no host imports.

import { hasChineseOnlyGlyphs, hasJapaneseOnlyGlyphs } from "./hanForms.ts";
import { HAN_CHAR, hasHan, hasKana } from "./kana.ts";

export type CjkDocumentBranch = "japanese" | "chinese" | undefined;
export type CjkLineRoute = "japanese" | "chinese" | undefined;

export type CjkDocumentContext = {
  readonly branch: CjkDocumentBranch;
  /**
   * The song pairs kana-bearing Japanese lines with long kana-free Han lines,
   * so those Han lines are Chinese rather than kanji-only Japanese.
   */
  readonly bilingual: boolean;
};

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

/**
 * Japanese lyric lines almost always carry kana, because particles and
 * inflection are written in kana. A run of this many Han characters with no
 * kana at all is therefore very likely Chinese, but only in a document that
 * already looks bilingual: an all-Japanese song may still contain a set
 * phrase such as 天上天下唯我独尊, and it must not be mistaken for Chinese.
 */
const HAN_RUN_CHINESE_LENGTH = 5;

/**
 * Normalize a line before any script test. Halfwidth katakana (ｱﾏﾂｷﾂﾈ) lives
 * in a different code range from normal kana, so without this a line written
 * that way reads as having no kana at all and gets routed as Chinese.
 * Detection only; the displayed text is never normalized.
 */
export function normalizeForDetection(line: string): string {
  return line.normalize("NFKC");
}

function hanCount(line: string): number {
  let count = 0;
  for (const ch of line) {
    if (HAN_CHAR.test(ch)) count += 1;
  }
  return count;
}

/**
 * Vocabulary signal: Chinese function words or word patterns. Reliable on
 * modern lyrics, but classical or literary lines (無可奈何花落去) contain
 * none, which is why the document context matters too.
 */
function hasChineseVocabulary(rawLine: string): boolean {
  const line = normalizeForDetection(rawLine);
  for (const ch of line) {
    if (CHINESE_MARKERS.has(ch)) return true;
  }
  const compact = line.replace(/\s+/gu, "");
  return CHINESE_BIGRAMS.some((bigram) => compact.includes(bigram));
}

/**
 * Positive evidence that a kana-free line is Chinese. Glyph forms are checked
 * alongside vocabulary because literary lines carry no function words, and
 * vocabulary is checked at all because a bilingual song's Chinese lines are
 * sometimes typed with Japanese glyph forms (継続 for 继续).
 */
function looksChinese(line: string): boolean {
  return hasChineseVocabulary(line) || hasChineseOnlyGlyphs(line);
}

/**
 * Classify the whole lyric document. A couple of kana lines mark the song as
 * Japanese; a clear majority of Han-only lines marks it as Chinese. A small
 * Japanese island must not flip an otherwise Chinese document, so Chinese
 * needs both an absolute floor and a 2:1 advantage.
 */
export function resolveDocumentBranch(lines: readonly string[]): CjkDocumentBranch {
  return resolveDocumentContext(lines).branch;
}

export function resolveDocumentContext(lines: readonly string[]): CjkDocumentContext {
  let kanaLines = 0;
  let hanOnlyLines = 0;
  let longHanOnlyLines = 0;
  for (const line of lines) {
    if (hasKana(line)) {
      kanaLines += 1;
    } else if (hasHan(line)) {
      hanOnlyLines += 1;
      const normalized = normalizeForDetection(line);
      // A line showing Japanese orthography is evidence of a Japanese song,
      // not of a second language, so it must not make the song look
      // bilingual unless it also carries positive Chinese evidence.
      if (
        looksChinese(normalized) ||
        (!hasJapaneseOnlyGlyphs(normalized) && hanCount(normalized) >= HAN_RUN_CHINESE_LENGTH)
      ) {
        longHanOnlyLines += 1;
      }
    }
  }

  let branch: CjkDocumentBranch;
  if (kanaLines === 0 && hanOnlyLines === 0) branch = undefined;
  else if (hanOnlyLines >= 2 && hanOnlyLines >= kanaLines * 2) branch = "chinese";
  else if (kanaLines >= 1) branch = "japanese";
  else branch = "chinese";

  // One stray set phrase is not a second language; a recurring pattern is.
  const bilingual = kanaLines >= 2 && longHanOnlyLines >= 2;
  return { branch, bilingual };
}

/**
 * Route one line, strongest evidence first:
 *
 * 1. kana present, so Japanese;
 * 2. positive Chinese evidence (vocabulary or Chinese-only glyph forms);
 * 3. Japanese-only glyph forms or the iteration mark;
 * 4. in a bilingual song, a long kana-free Han run;
 * 5. otherwise the document branch.
 *
 * Chinese evidence outranks Japanese glyph forms because a Chinese sentence
 * typed with Japanese forms is still Chinese, while 的 as a particle is not
 * Japanese at all.
 */
export function resolveLineRoute(
  rawLine: string,
  doc: CjkDocumentBranch | CjkDocumentContext,
): CjkLineRoute {
  const context: CjkDocumentContext =
    typeof doc === "object" && doc !== null ? doc : { branch: doc, bilingual: false };
  const line = normalizeForDetection(rawLine);
  const kana = hasKana(line);
  const han = hasHan(line);
  if (!kana && !han) return undefined;
  if (kana) return "japanese";
  if (looksChinese(line)) return "chinese";
  if (hasJapaneseOnlyGlyphs(line)) return "japanese";
  if (context.bilingual && hanCount(line) >= HAN_RUN_CHINESE_LENGTH) return "chinese";
  return context.branch ?? "chinese";
}
