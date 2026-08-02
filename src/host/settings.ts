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
};

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
