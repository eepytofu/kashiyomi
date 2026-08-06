// Lyric files usually open with credit lines (作詞: …, 编曲：…, Vocal: …).
// They are not lyrics: annotating them adds noise and translating them wastes
// a request, so they are detected and left alone. Pure; no host imports.

import { hasKana } from "./kana.ts";

/**
 * Labels are compared with spacing and interpuncts removed, so that 作 词 and
 * 作词, or "Special Thanks" and "special thanks", are the same label.
 */
function normalizeLabel(label: string): string {
  return label.replace(/[\s·・]/gu, "").toLowerCase();
}

/**
 * The pieces credit labels are built from, not the labels themselves.
 *
 * This used to be a list of whole labels, and every miss reported against it
 * was the same shape: a real role the list did not happen to contain. 录音 was
 * listed and 录音室 was not; 和声 and 编写 were listed and 和声编写 was not; 声
 * appeared only inside 人声 and 和声, so 女声 was a lyric. Chinese role labels
 * are compounds, so enumerating them is enumerating a product set — the list
 * grows forever and is never finished.
 *
 * Listing the *morphemes* instead makes the compounds fall out. Entries longer
 * than one character are here because they do not decompose (吉他, 琵琶,
 * イラスト) or because their parts are too weak to carry a label alone (工作室,
 * 特别感谢).
 */
const ROLE_MORPHEMES = new Set([
  // Chinese, one character: the productive pieces. 声 alone covers 女声/男声/
  // 童声/和声/人声, which is six table entries the old list needed separately.
  "词", "詞", "曲", "编", "編", "写", "寫", "唱", "声", "聲", "音", "作", "填",
  "谱", "譜", "制", "製", "演", "奏", "混", "录", "錄", "调", "調", "校", "教",
  "绘", "繪", "画", "畫", "著", "效", "轨", "軌", "字", "鼓", "笛", "琴", "胡",
  // Modifiers that specify a role rather than name one. They never stand alone
  // as a label: at the 2/3 threshold 女 or 主 on its own leaves a two-character
  // label at 0.50 and it stays a lyric.
  //
  // 人 is deliberately absent, and 人声 listed whole instead. As a morpheme it
  // made 女人, 男人 and 主人 into credits at 1.00, so a song with spoken parts
  // would lose the labelled line and the dialogue on it. It is the one modifier
  // here that is also an everyday noun.
  "主", "女", "男", "童", "合", "伴", "领", "領", "独", "獨", "配", "原",
  "和", "翻", "改", "特", "总", "總", "副",
  "人声", "人聲",
  // Chinese, multi-character: no usable decomposition, or the parts are too
  // weak. 子 in 笛子 and 室 in 录音室 are not roles in any other label.
  "笛子", "吉他", "贝斯", "貝斯", "琵琶", "古筝", "古箏", "二胡", "唢呐", "尺八",
  "古琴", "扬琴", "提琴", "弦乐", "弦樂", "键盘", "鍵盤", "乐器", "樂器", "乐队",
  "樂隊", "单簧管", "萨克斯", "打击乐", "合成器", "工作室",
  "母带", "母帶", "后期", "後期", "分轨", "缩混", "縮混", "插画", "插畫", "插图",
  "插圖", "美工", "视频", "視頻", "动画", "動畫", "影像", "海报", "海報", "封面",
  "设计", "設計", "视觉", "視覺", "摄影", "攝影", "题字", "題字",
  "出品", "监制", "監製", "统筹", "統籌", "策划", "策劃", "企划", "企劃", "宣传",
  "宣傳", "发行", "發行", "推广", "推廣", "营销", "營銷", "经纪", "經紀", "艺人",
  "藝人", "运营", "運營", "商务", "商務", "厂牌", "廠牌", "平台", "单位", "單位",
  "团队", "團隊", "顾问", "顧問",
  "鸣谢", "鳴謝", "感谢", "感謝", "协力", "協力", "助理", "文案", "编辑", "編輯",
  "监督", "監督", "念白", "旁白", "声优", "聲優", "别", "別", "谢", "謝",
  "歌手", "表演者", "演唱者", "演奏者",
  // Japanese. Katakana roles do not decompose at all.
  "訳", "唄", "歌", "ボーカル", "ヴォーカル", "コーラス", "ミックス", "マスタリング",
  "レコーディング", "イラスト", "映像", "編集", "楽曲", "企画", "調声",
  // English. Kept as whole words: a morpheme cut does nothing here, and the
  // cover ratio counts characters, so "by" and "special" have to be listed for
  // "composed by" and "special thanks" to reach the threshold.
  "lyrics", "lyric", "composer", "composed", "arranger", "arrangement",
  "arranged", "vocal", "vocals", "vocalist", "singer", "artist", "music",
  "written", "writer", "producer", "produced", "production", "mix", "mixing",
  "mixed", "mastering", "master", "recording", "record", "illustration",
  "illust", "movie", "video", "guitar", "bass", "drums", "drum", "piano",
  "keyboard", "strings", "string", "chorus", "tuning", "encoding", "special",
  "thanks", "translation", "translated", "original", "song", "engineer",
  "engineering", "percussion", "programming", "programing", "by", "pv", "sp",
  "op", "mv",
].map(normalizeLabel));

/**
 * How much of a label is accounted for by role morphemes, 0 to 1.
 *
 * Longest-cover dynamic program: `best[i]` is the most characters coverable in
 * the first `i`. Uncovered characters are skipped rather than failing the
 * label, which is the whole difference from the exact decomposition this
 * replaces — 录音室 scores 0.67 instead of failing outright on 室.
 */
function roleCoverRatio(label: string): number {
  const chars = [...label];
  if (chars.length === 0) return 0;
  const best: number[] = new Array(chars.length + 1).fill(0);
  for (let start = 0; start < chars.length; start++) {
    if (best[start]! > best[start + 1]!) best[start + 1] = best[start]!;
    for (let end = start + 1; end <= chars.length; end++) {
      if (!ROLE_MORPHEMES.has(chars.slice(start, end).join(""))) continue;
      const covered = best[start]! + (end - start);
      if (covered > best[end]!) best[end] = covered;
    }
  }
  return best[chars.length]! / chars.length;
}

/**
 * Two thirds, and it is derived rather than tuned: it is exactly the ratio of
 * 录音室 (录音 + 室), the label that forced this rewrite. Read as a rule it says
 * a two-character label needs both characters covered, a three-character label
 * needs two, a four needs three.
 *
 * It sits high on purpose. A label this test *misses* is still recovered by the
 * credit run in `lineKinds.ts`, which needs no vocabulary at all; a label it
 * wrongly *accepts* is recovered by nothing and silently drops a sung line. So
 * the bound is set by the weakest real credit we want to anchor a run, not by
 * the strongest counterexample — at 0.50 the two-character case collapses, and
 * 词穷 becomes indistinguishable from 女声.
 *
 * Measured over 33 labels observed in captures and screenshots: 0.67 accepts
 * 28, and the five below it (文案故事 at 0.50 is the clearest) are all inside a
 * credit block, where the run reaches them anyway.
 */
const ROLE_COVER_MIN = 2 / 3;

// A short label, optionally numbered, followed by a colon and a value. The
// bound is only a cheap prefilter — every part still has to be a known role —
// so it has to be loose enough for real compound credits. At 20 it rejected
// "Lyrics & Music & Arrangement:" and "special thanks & translation:", both of
// which are ordinary on Vocaloid uploads.
const CREDIT_LINE =
  /^\s*(?:\d{1,3}\s*[.．、)]\s*)?([\p{L}\p{N}][\p{L}\p{N}\s&/・·,，、-]{0,40}?)\s*[:：]\s*(\S.*)$/u;

/**
 * True when the line is a production credit rather than a lyric. Requires a
 * recognized label, so a lyric that happens to contain a colon is not lost.
 */
export function isCreditLine(line: string): boolean {
  const match = CREDIT_LINE.exec(line);
  if (!match) return false;
  // The capture group starts with [\p{L}\p{N}] and normalizeLabel only strips
  // spaces and interpuncts, so the label is never empty here.
  const label = normalizeLabel(match[1] ?? "");
  // A label may list several roles at once: 词/曲, 编曲/和声编写, Lyrics & Music.
  // Each side has to stand on its own, so that 作词/张三 — a role beside a name,
  // which is a lyric-side slash — is not accepted because half of it matched.
  // Empty parts are kept rather than filtered. A trailing or doubled separator
  // ("Lyrics&", 作词、) leaves one, it covers nothing, and so it fails the
  // threshold on its own — which is what stops a role plus a stray separator
  // from being read as a credit. Filtering them first is what made the old code
  // need a separate part-count check.
  const parts = label.split(/[&/,，、]/u);
  return parts.every((part) => roleCoverRatio(part) >= ROLE_COVER_MIN);
}

/**
 * True when the line is a rights notice rather than a lyric — 未经许可不得使用,
 * 本歌曲版权由…享有, 版权所有 侵权必究.
 *
 * These carry no label and no colon, so neither credit test can see them: they
 * are whole sentences, and they get pinyin and a translation request like any
 * other line.
 *
 * Matching is by term count rather than by containment, because the vocabulary
 * splits cleanly in two and treating it as one set would misfire. 版权, 侵权 and
 * 著作权 are legal words that no lyric uses, so one is enough. The rest are
 * ordinary Chinese — 不得 in particular is everywhere in literary lyrics
 * (不得不, 舍不得) — so they only count in company.
 */
export function isCopyrightNotice(line: string): boolean {
  for (const term of RIGHTS_TERMS) {
    if (line.includes(term)) return true;
  }
  let hits = 0;
  for (const term of NOTICE_TERMS) {
    if (line.includes(term) && ++hits === 2) return true;
  }
  return false;
}

/** Legal vocabulary. One is decisive; a lyric has no use for these words. */
const RIGHTS_TERMS = ["版权", "版權", "侵权", "侵權", "著作权", "著作權"];

/**
 * Ordinary words that only mean something together. Every standard notice
 * carries at least two: 未经许可不得使用 has four, 未经授权请勿转载 has three.
 */
const NOTICE_TERMS = [
  "未经", "未經", "许可", "許可", "授权", "授權", "不得", "请勿", "請勿",
  "翻录", "翻錄", "转载", "轉載", "商业用途", "商業用途", "保留一切权利",
];

/**
 * True when the whole line is a singer or section marker: 【合】, 【海伊】,
 * [Chorus]. Duet uploads put these on their own line to say who sings next.
 * They are not lyrics — romanizing 【合】 as "hé" and translating it is noise —
 * and they carry no role label, so `isCreditLine` cannot see them.
 */
export function isPartMarkerLine(line: string): boolean {
  return PART_MARKER_LINE.test(line);
}

// Bounded, because an entire lyric line is sometimes parenthesized and that is
// still a lyric. Names and section words are short.
const PART_MARKER_LINE = /^\s*[【〖\[(（]\s*[^】〗\])）]{1,12}\s*[】〗\])）]\s*$/u;

/**
 * True when a line is *shaped* like a credit — a short label, then a colon,
 * then a value — without requiring the label to be a role we know.
 *
 * The role table cannot be complete (`PV:`, `Mastering Engineer:`, `特效:` are
 * all real and all absent), and an unrecognized credit becomes a lyric: it gets
 * annotated and sent to the translator. This is the weaker test a caller can
 * combine with evidence the table does not have — where the line sits in the
 * song, and whether the player translated it.
 *
 * Deliberately stricter than `CREDIT_LINE` on the label, because on its own
 * this would swallow lyrics: no kana (roles are written in kanji or Latin, so
 * "君に言った: さよなら" is excluded) and short.
 */
export function hasCreditShape(line: string): boolean {
  const match = CREDIT_LINE.exec(line);
  if (!match) return false;
  const label = match[1] ?? "";
  if (hasKana(label)) return false;
  for (const ch of label) {
    if (SENTENCE_CHARS.has(ch)) return false;
  }
  return normalizeLabel(label).length <= CREDIT_SHAPE_MAX_LABEL;
}

/** "masteringengineer" is 17, and real roles do not run much past that. */
const CREDIT_SHAPE_MAX_LABEL = 20;

/**
 * A role label is a noun phrase. These characters belong to sentences, so a
 * "label" holding one is a lyric that happens to contain a colon —
 * 答案是：我不知道 is the case that forced this. Kept deliberately small, and
 * free of characters that appear in real roles (和 rules out 和声, 制 rules out
 * 制作人).
 */
const SENTENCE_CHARS = new Set([..."是不我你他她們们的了吗嗎呢吧很麼么怎"]);
