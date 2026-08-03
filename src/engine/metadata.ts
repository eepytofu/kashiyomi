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

// Credit labels seen in Chinese, Japanese and English lyric headers,
// including the Vocaloid-specific production roles. Normalized on the way in:
// the lookup key has its spaces stripped, so an entry written with a space
// could never be matched otherwise. That silently disabled every multi-word
// English role ("composed by", "special thanks", …); "originalsong" below is
// a leftover hand-workaround for the same problem.
const CREDIT_LABELS = new Set([
  // Chinese
  "作词", "作詞", "填词", "填詞", "作曲", "谱曲", "譜曲", "编曲", "編曲",
  "词", "詞", "曲", "编", "編", "唱", "演唱", "原唱", "翻唱", "主唱", "和声", "和聲",
  "歌手", "歌手名", "表演者", "制作人", "製作人", "出品", "出品人", "监制", "監製",
  "统筹", "統籌", "策划", "策劃", "企划", "企劃", "宣传", "宣傳", "发行", "發行",
  "混音", "母带", "母帶", "后期", "後期", "录音", "錄音", "调校", "調校", "调教", "調教",
  "曲绘", "曲繪", "美工", "视频", "視頻", "动画", "動畫", "导唱", "導唱", "导唱协力",
  "特别感谢", "特別感謝", "鸣谢", "鳴謝", "原曲", "改编", "改編", "翻译", "翻譯",
  "吉他", "贝斯", "貝斯", "鼓", "键盘", "鍵盤", "弦乐", "弦樂", "笛子", "古筝", "古箏",
  "二胡", "琵琶", "配器", "乐器", "樂器", "人声", "人聲", "伴奏",
  // Roles written as one run without a separator
  "作词作曲", "作詞作曲", "作曲作词", "作曲作詞", "词曲", "詞曲", "曲词", "曲詞",
  "作编曲", "作編曲", "词曲编", "詞曲編",
  // Japanese
  "訳詞", "唄", "歌", "歌唱", "ボーカル", "ヴォーカル", "コーラス",
  "ミックス", "マスタリング", "レコーディング", "イラスト", "動画", "映像",
  "調声", "調教", "編集", "演奏", "楽曲", "制作", "企画", "originalsong",
  // English
  "lyrics", "lyric", "composer", "composed by", "arranger", "arrangement",
  "arranged by", "vocal", "vocals", "vocalist", "singer", "artist", "music",
  "written by", "producer", "produced by", "mix", "mixing", "mastering",
  "recording", "illustration", "illust", "movie", "video", "guitar", "bass",
  "drums", "piano", "keyboard", "strings", "chorus", "tuning", "encoding",
  "special thanks", "translation", "translated by", "original",
].map(normalizeLabel));

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
  if (CREDIT_LABELS.has(label)) return true;
  // Compound labels such as 作词作曲 or 词/曲 list several roles at once. The
  // count check is load-bearing, not redundant: "Lyrics&:" normalizes to
  // "lyrics&", which fails the direct lookup but splits to the single valid
  // part ["lyrics"], so without it a trailing separator would be accepted.
  const parts = label.split(/[&/,，、]/u).filter((part) => part !== "");
  return parts.length > 1 && parts.every((part) => CREDIT_LABELS.has(part));
}

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
