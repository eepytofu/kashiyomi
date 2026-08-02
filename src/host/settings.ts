// Plugin settings persisted as one JSON blob in localStorage.

export type Settings = {
  furigana: boolean;
  romaji: boolean;
  pinyin: boolean;
  pinyinTones: boolean;
  pinyinJoinWords: boolean;
  hanRepair: boolean;
  readingHints: boolean;
  debug: boolean;
  /** rt size as a percentage of the base lyric font. */
  furiganaSize: number;
  /** Use a Japanese font stack on Japanese lyric lines (Han unification). */
  useJpFont: boolean;
  jpFontStack: string;
};

export const DEFAULT_JP_FONT_STACK =
  "'Yu Gothic UI', 'Yu Gothic', 'Meiryo', 'Noto Sans JP', 'Source Han Sans JP', sans-serif";

const KEY = "kashiyomi:settings";

const DEFAULTS: Settings = {
  furigana: true,
  romaji: true,
  pinyin: true,
  pinyinTones: true,
  pinyinJoinWords: true,
  hanRepair: true,
  readingHints: true,
  debug: true,
  furiganaSize: 50,
  useJpFont: true,
  jpFontStack: DEFAULT_JP_FONT_STACK,
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
