// Per-line CJK routing: decide whether a lyric line should get Japanese

import { hasChineseOnlyGlyphs, hasJapaneseOnlyGlyphs } from "./hanForms.ts";
import { projectReadingHints } from "./hints.ts";
import { HAN_CHAR, KANA_CHAR, hasHan, hasKana } from "./kana.ts";
import { toLatinPunctuation } from "./latinPunctuation.ts";
import { romanizeMandarin, type PinyinOptions } from "./pinyin.ts";
import { kanaToRomaji } from "./romaji.ts";

export type CjkDocumentBranch = "japanese" | "chinese" | undefined;
export type CjkLineRoute = "japanese" | "chinese" | "mixed" | undefined;

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
 */
export type LineTranslationState = "translated" | "untranslated" | "unknown";

// Characters that are ordinary Chinese function words and essentially never
// appear in Japanese lyric text.
const CHINESE_MARKERS = new Set(
  [..."的是你她们們这這么麼怎吗嗎呢吧让讓给说說个咱您哪嘛很什也"],
);

// Dropped on 2026-08-04: 給. It is the traditional form of 给, and it is also

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

/**
 * Japanese lyric lines almost always carry kana, because particles and
 */
const HAN_RUN_CHINESE_LENGTH = 5;

/**
 * Normalize a line before any script test. Halfwidth katakana (ｱﾏﾂｷﾂﾈ) lives
 * in a different code range from normal kana, so without this a line written
 * that way reads as having no kana at all and gets routed as Chinese.
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
 */
function looksChinese(line: string): boolean {
  return hasChineseVocabulary(line) || hasChineseOnlyGlyphs(line);
}

/**
 * Classify the whole lyric document. A couple of kana lines mark the song as
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
  const bilingual =
    distinctKanaLines >= 2 && chineseEvidenceLines >= 1 && longHanOnlyLines >= 2;
  const hasTranslations = translationStates.some((state) => state === "translated");
  return { branch, bilingual, hasTranslations };
}

/** Route one line, strongest evidence first: */
export function resolveLineRoute(
  rawLine: string,
  doc: CjkDocumentBranch | CjkDocumentContext,
  translation: LineTranslationState = "unknown",
): CjkLineRoute {
  const context: CjkDocumentContext =
    typeof doc === "object" && doc !== null
      ? doc
      : { branch: doc, bilingual: false, hasTranslations: false };
  // A parenthetical reading hint is markup, not a kana loan. 如果天(そら) is
  // not one: a line-final kana paren with no real context around it is a chant.
  const line = projectReadingHints(normalizeForDetection(rawLine)).displayText;
  const kana = hasKana(line);
  const han = hasHan(line);
  if (!kana && !han) return undefined;
  // A Chinese song sometimes ends a Mandarin line with one short kana loan
  // (すみません). That is not a Japanese sentence: the Han is read as
  // Mandarin and the kana as romaji. Kana between Han, a second kana run,
  // or as much kana as Han is still a Japanese line.
  if (kana && han && context.branch === "chinese" && isEdgeKanaLoan(line)) return "mixed";
  if (kana) return "japanese";
  // In a song the player is translating into Chinese, whether this line got a
  if (context.hasTranslations && translation === "translated") return "japanese";
  if (context.hasTranslations && translation === "untranslated") return "chinese";
  if (looksChinese(line)) return "chinese";
  if (hasJapaneseOnlyGlyphs(line)) return "japanese";
  if (context.bilingual && hanCount(line) >= HAN_RUN_CHINESE_LENGTH) return "chinese";
  return context.branch ?? "chinese";
}

/**
 * True when the only kana is one run at the start or the end, and there is
 * less of it than Han. Spaces and punctuation do not break the run. Han does.
 */
function isEdgeKanaLoan(line: string): boolean {
  let kanaCount = 0;
  let hanCount = 0;
  let kanaRuns = 0;
  let inKanaRun = false;
  let first: "han" | "kana" | undefined;
  let last: "han" | "kana" | undefined;
  for (const ch of line) {
    if (KANA_CHAR.test(ch)) {
      kanaCount += 1;
      if (!inKanaRun) kanaRuns += 1;
      inKanaRun = true;
      first ??= "kana";
      last = "kana";
    } else if (HAN_CHAR.test(ch)) {
      hanCount += 1;
      inKanaRun = false;
      first ??= "han";
      last = "han";
    }
  }
  if (kanaCount === 0 || hanCount === 0) return false;
  const kanaIsInternal = first === "han" && last === "han";
  return kanaRuns === 1 && !kanaIsInternal && kanaCount < hanCount;
}

// An opening bracket belongs to the run that follows it. A closing bracket
// belongs to the run it ends. Splitting the pair across Han and kana is what
// turned 如果天(そら) into "ru guo tian ( sora)".
const OPENING_BRACKET = /[（(「『【《〈〔〖［\[]/u;
const CLOSING_BRACKET = /[）)」』】》〉〕〗］\]]/u;

/**
 * The reading row for a mixed line: Mandarin for each Han run, romaji for
 * each kana run. Leading punctuation is kept, and each bracket stays with
 * the run it belongs to. Accepted reading hints are removed first.
 */
export function projectMixedLineReading(text: string, options: PinyinOptions): string {
  const line = projectReadingHints(normalizeForDetection(text)).displayText;
  const parts: string[] = [];
  let kind: "han" | "kana" | undefined;
  let run = "";
  // Opening brackets, plus any non-script run that has not found a word yet.
  let pending = "";
  const flush = (): void => {
    const script = kind;
    const value = run.trim();
    kind = undefined;
    run = "";
    if (script === undefined || value === "") return;
    const reading = script === "han" ? romanizeMandarin(value, options) : kanaToRomaji(value);
    const trimmed = reading.trim();
    if (trimmed !== "") parts.push(trimmed);
  };
  for (const ch of line) {
    if (OPENING_BRACKET.test(ch)) {
      pending += ch;
      continue;
    }
    if (CLOSING_BRACKET.test(ch) || (!HAN_CHAR.test(ch) && !KANA_CHAR.test(ch))) {
      if (kind === undefined) pending += ch;
      else run += ch;
      continue;
    }
    const script = HAN_CHAR.test(ch) ? "han" : "kana";
    if (kind !== script) {
      flush();
      kind = script;
      run = pending;
      pending = "";
    } else if (pending !== "") {
      run += pending;
      pending = "";
    }
    run += ch;
  }
  flush();
  const tail = pending.trim();
  if (tail !== "") {
    const literal = toLatinPunctuation(tail);
    if (literal !== "") parts.push(literal);
  }
  return parts.join(" ");
}
