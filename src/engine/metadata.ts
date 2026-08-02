// Lyric files usually open with credit lines (作詞: …, 编曲：…, Vocal: …).
// They are not lyrics: annotating them adds noise and translating them wastes
// a request, so they are detected and left alone. Pure; no host imports.

// Credit labels seen in Chinese, Japanese and English lyric headers,
// including the Vocaloid-specific production roles. Lowercased for matching.
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
]);

// A short label, optionally numbered, followed by a colon and a value.
const CREDIT_LINE =
  /^\s*(?:\d{1,3}\s*[.．、)]\s*)?([\p{L}\p{N}][\p{L}\p{N}\s&/・·,，、-]{0,20}?)\s*[:：]\s*(\S.*)$/u;

function normalizeLabel(label: string): string {
  return label.replace(/[\s·・]/gu, "").toLowerCase();
}

/**
 * True when the line is a production credit rather than a lyric. Requires a
 * recognized label, so a lyric that happens to contain a colon is not lost.
 */
export function isCreditLine(line: string): boolean {
  const match = CREDIT_LINE.exec(line);
  if (!match) return false;
  const label = normalizeLabel(match[1] ?? "");
  if (label === "") return false;
  if (CREDIT_LABELS.has(label)) return true;
  // Compound labels such as 作词作曲 or 词/曲 list several roles at once.
  const parts = label.split(/[&/,，、]/u).filter((part) => part !== "");
  return parts.length > 1 && parts.every((part) => CREDIT_LABELS.has(part));
}
