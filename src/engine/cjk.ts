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
  /**
   * The player is showing Chinese translations for at least some lines, which
   * makes their presence per line meaningful evidence.
   */
  readonly hasTranslations: boolean;
};

/**
 * Whether the player shows a Chinese translation under this particular line.
 * NetEase translates foreign lyrics into Chinese and has no reason to
 * translate a Chinese line, so within a song that carries translations, a
 * translated line is not Chinese and an untranslated one very likely is.
 */
export type LineTranslationState = "translated" | "untranslated" | "unknown";

// Characters that are ordinary Chinese function words and essentially never
// appear in Japanese lyric text.
const CHINESE_MARKERS = new Set(
  [..."的是你她们們这這么麼怎吗嗎呢吧让讓给说說个咱您哪嘛很什也"],
);

// Dropped on 2026-08-04: 給. It is the traditional form of 给, and it is also
// the everyday Japanese kanji — SudachiDict has 給料, 供給, 配給, 支給, 給料日,
// 供給源 — so it is character-identical to ordinary Japanese, the same test that
// removed 時候/過去/現在/出來. NetEase ships simplified (4/4 songs captured), so
// 給 could only ever misfire here while 给 does the work. Reopen if a captured
// NetEase song is served in traditional and uses 給 as the verb.
//
// Checked and kept in the same pass: 讓 is only a given name in SudachiDict
// (ユズル, and names land in credit lines, which are skipped); 說 and 麼 are OOV
// entirely; 一個 tokenizes as 一 + 個 (numeral plus counter), not as a word, so
// it cannot appear in a kana-free Japanese line the way 時候 could.

// Chinese word patterns whose characters are individually ambiguous but whose
// pairing is not.
const CHINESE_BIGRAMS = [
  "我不", "不要", "不想", "不是", "不会", "不能", "我的", "你的", "他的", "她的",
  "我们", "我們", "你们", "你們", "他们", "他們", "一个", "一個", "这个", "這個",
  "那个", "那個", "什么", "什麼", "怎么", "怎麼", "因为", "因為", "所以", "可以",
  "已经", "已經", "还是", "還是", "就是", "没有", "沒有", "知道", "时候",
  "如果", "但是", "只是", "还有", "還有", "多少", "为了", "為了", "一起", "起来",
  "起來", "出来", "下去", "过去", "现在",
];

// Dropped on 2026-08-03: 時候, 過去, 現在, 出來. Each is a traditional form that
// is character-identical to an ordinary Japanese word (ジコウ, カコ, ゲンザイ,
// デキ), so it could only ever misfire here — NetEase is a mainland service and
// ships simplified, including in credit labels, on every song captured so far.
// The simplified twins 时候/过去/现在/出来 stay; 出来 is also common Japanese, but
// unlike the others it is genuinely the form this platform serves.

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
 * needs a 2:1 advantage in Han-only lines.
 *
 * There used to be an absolute floor of two Han-only lines alongside the
 * ratio. It never did anything: the only case it excluded (no kana lines, one
 * Han-only line) falls through to the final branch, which returns "chinese"
 * regardless.
 */
export function resolveDocumentBranch(lines: readonly string[]): CjkDocumentBranch {
  return resolveDocumentContext(lines).branch;
}

export function resolveDocumentContext(
  lines: readonly string[],
  translationStates: readonly LineTranslationState[] = [],
): CjkDocumentContext {
  // Composition: how much of the song is kana-bearing versus kana-free. A
  // repeated chorus really is more of the document, so this counts every
  // occurrence.
  let kanaLines = 0;
  let hanOnlyLines = 0;
  for (const line of lines) {
    if (hasKana(line)) kanaLines += 1;
    else if (hasHan(line)) hanOnlyLines += 1;
  }

  // Evidence of a *second language* is counted over distinct lines instead. A
  // chorus line repeated four times is one piece of evidence, not four:
  // counting occurrences let 千本桜's twice-repeated 三千世界 常世之闇 make the
  // song look bilingual by itself, after which every kana-free line in it
  // routed to Chinese.
  let distinctKanaLines = 0;
  let longHanOnlyLines = 0;
  let chineseEvidenceLines = 0;
  for (const line of new Set(lines)) {
    if (hasKana(line)) {
      distinctKanaLines += 1;
      continue;
    }
    if (!hasHan(line)) continue;
    const normalized = normalizeForDetection(line);
    const chinese = looksChinese(normalized);
    if (chinese) chineseEvidenceLines += 1;
    // A line showing Japanese orthography is evidence of a Japanese song, not
    // of a second language, so it must not count unless it also carries
    // positive Chinese evidence.
    if (
      chinese ||
      (!hasJapaneseOnlyGlyphs(normalized) && hanCount(normalized) >= HAN_RUN_CHINESE_LENGTH)
    ) {
      longHanOnlyLines += 1;
    }
  }

  let branch: CjkDocumentBranch;
  if (kanaLines === 0 && hanOnlyLines === 0) branch = undefined;
  else if (hanOnlyLines >= kanaLines * 2) branch = "chinese";
  else if (kanaLines >= 1) branch = "japanese";
  else branch = "chinese";

  // A second language has to actually show itself. Length is not evidence:
  // the absence of Japanese orthography is not the presence of Chinese, and
  // treating it as such made an all-Japanese song of four-character compounds
  // (千本桜) look bilingual. So require at least one line carrying positive
  // Chinese evidence — vocabulary or Chinese-only glyph forms — as well as a
  // recurring pattern of kana-free lines rather than one stray set phrase.
  const bilingual =
    distinctKanaLines >= 2 && chineseEvidenceLines >= 1 && longHanOnlyLines >= 2;
  const hasTranslations = translationStates.some((state) => state === "translated");
  return { branch, bilingual, hasTranslations };
}

/**
 * Route one line, strongest evidence first:
 *
 * 1. kana present, so Japanese;
 * 2. the player is translating this song and translated this line, so it is
 *    not Chinese — NetEase translates foreign lyrics into Chinese and has no
 *    reason to translate a Chinese line;
 * 3. the same song, but this line went untranslated, so it is Chinese;
 * 4. positive Chinese evidence (vocabulary or Chinese-only glyph forms);
 * 5. Japanese-only glyph forms or the iteration mark;
 * 6. in a bilingual song, a long kana-free Han run;
 * 7. otherwise the document branch.
 *
 * The translation slot outranks every character heuristic because it is what
 * the player itself concluded about the line, per line, rather than a guess
 * from its glyphs. It only speaks when 译 is on; rungs 4-7 are the fallback
 * for when it is off, and 無 (立入禁止/歌爱ユキ/诗岸) is the song that needs
 * them.
 *
 * Below the translation slot, Chinese evidence outranks Japanese glyph forms
 * because a Chinese sentence typed with Japanese forms is still Chinese, while
 * 的 as a particle is not Japanese at all.
 */
export function resolveLineRoute(
  rawLine: string,
  doc: CjkDocumentBranch | CjkDocumentContext,
  translation: LineTranslationState = "unknown",
): CjkLineRoute {
  const context: CjkDocumentContext =
    typeof doc === "object" && doc !== null
      ? doc
      : { branch: doc, bilingual: false, hasTranslations: false };
  const line = normalizeForDetection(rawLine);
  const kana = hasKana(line);
  const han = hasHan(line);
  if (!kana && !han) return undefined;
  if (kana) return "japanese";
  // In a song the player is translating into Chinese, whether this line got a
  // translation says more than any character heuristic: a Japanese line typed
  // with a Chinese-only glyph form used to route Chinese even while NCM was
  // visibly showing a translation for it.
  if (context.hasTranslations && translation === "translated") return "japanese";
  if (context.hasTranslations && translation === "untranslated") return "chinese";
  if (looksChinese(line)) return "chinese";
  if (hasJapaneseOnlyGlyphs(line)) return "japanese";
  if (context.bilingual && hanCount(line) >= HAN_RUN_CHINESE_LENGTH) return "chinese";
  return context.branch ?? "chinese";
}
