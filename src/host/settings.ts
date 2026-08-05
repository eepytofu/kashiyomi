// Plugin settings persisted as one JSON blob in localStorage.

export type Settings = {
  furigana: boolean;
  romaji: boolean;
  pinyin: boolean;
  pinyinTones: boolean;
  pinyinJoinWords: boolean;
  hanRepair: boolean;
  readingHints: boolean;
  /** Annotate production credit lines (作詞: …) as if they were lyrics. */
  annotateCredits: boolean;
  debug: boolean;
  /** rt size as a percentage of the base lyric font. */
  furiganaSize: number;
  /** Use a Japanese font stack on Japanese lyric lines (Han unification). */
  useJpFont: boolean;
  jpFontStack: string;
  /**
   * Use a Chinese font stack on Chinese text: Chinese lyrics, and Chinese
   * translation lines under foreign lyrics.
   */
  useZhFont: boolean;
  zhFontStack: string;
  /**
   * Font for reading rows (romaji, pinyin) and for translation rows carrying no
   * CJK of their own. Without it a row inherits its lyric's script, so the same
   * romaji renders in two different faces on a bilingual page — 58 rows split
   * across both stacks on 無. Following the document branch instead was
   * rejected: it gives one face per song but changes face *between* songs,
   * which is worse than the inconsistency it fixes.
   */
  useRowFont: boolean;
  rowFontStack: string;
  /** Settings panel language; unset follows the page locale. */
  panelLang?: "en" | "zh";
  aiAutoTranslate: boolean;
  aiProvider: "openai" | "gemini";
  aiBaseUrl: string;
  aiApiKey: string;
  aiModel: string;
  aiTargetLang: string;
  aiCustomPrompt: string;
};

export const DEFAULT_JP_FONT_STACK =
  "'Yu Gothic UI', 'Yu Gothic', 'Meiryo', 'Noto Sans JP', 'Source Han Sans JP', sans-serif";

export const DEFAULT_ZH_FONT_STACK =
  "'Microsoft YaHei UI', 'Microsoft YaHei', 'Noto Sans SC', 'Source Han Sans SC', sans-serif";

const KEY = "kashiyomi:settings";

/**
 * Furigana size as a percentage of the lyric text, bounded so the slider cannot
 * be dragged into a setting that looks like a bug. NCM renders lyrics at 22px,
 * so 50% is 11px and the old floor of 10% was 2.2px (measured 2026-08-04).
 * Kanji carry far more strokes per em than Latin, so ruby stops being readable
 * well above the size at which Latin still is.
 */
export const MIN_FURIGANA_SIZE = 50;
export const MAX_FURIGANA_SIZE = 100;

const DEFAULTS: Settings = {
  furigana: true,
  romaji: true,
  pinyin: true,
  pinyinTones: true,
  pinyinJoinWords: true,
  hanRepair: true,
  readingHints: true,
  annotateCredits: false,
  debug: true,
  furiganaSize: 50,
  useJpFont: true,
  jpFontStack: DEFAULT_JP_FONT_STACK,
  useZhFont: false,
  zhFontStack: DEFAULT_ZH_FONT_STACK,
  // Latin, so the Japanese stack is a starting point rather than a claim about
  // the text; a mainland user can point it at the Chinese one.
  useRowFont: true,
  rowFontStack: DEFAULT_JP_FONT_STACK,
  aiAutoTranslate: false,
  aiProvider: "openai",
  aiBaseUrl: "https://api.openai.com/v1",
  aiApiKey: "",
  aiModel: "",
  aiTargetLang: "English",
  aiCustomPrompt: "",
};

let current: Settings | undefined;

export function getSettings(): Settings {
  if (!current) {
    try {
      const raw = localStorage.getItem(KEY);
      current = raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : { ...DEFAULTS };
    } catch {
      current = { ...DEFAULTS };
    }
  }
  return current;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  current = { ...getSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // localStorage full or unavailable; keep the in-memory value.
  }
  return current;
}
