// Panel UI strings. English and Simplified Chinese; the default follows the
// page locale (NCM is usually zh-CN) until the user picks one.

import { getSettings, updateSettings } from "./settings.ts";

export type PanelLang = "en" | "zh";

const STRINGS = {
  en: {
    analyzerReady: "Analyzer ready",
    analyzerLoading: "Dictionary loading",
    analyzerNotStarted: "Analyzer not started",
    analyzerFailed: "Analyzer failed",
    reannotate: "Re-annotate",
    sectionJapanese: "Japanese",
    sectionChinese: "Chinese",
    sectionAdvanced: "Advanced",
    furigana: "Furigana",
    furiganaDesc: "Readings above kanji",
    romaji: "Romaji line",
    romajiDesc: "A small romaji line under the lyric",
    hints: "Reading hints",
    hintsDesc: "Use readings the lyric itself provides, like 天(そら); shown in a different color",
    repair: "Kanji repair",
    repairDesc: "Fix Chinese glyph forms in Japanese lyrics, like 梦见ては to 夢見ては",
    furiganaSize: "Furigana size",
    furiganaSizeDesc: "Reading size relative to the lyric text",
    jpFont: "Japanese font on Japanese lyrics",
    jpFontDesc: "The same Han character can render with a Chinese glyph; force a Japanese font stack",
    fontStack: "Japanese font stack",
    fontStackDesc: "Installed fonts, first choice to fallback",
    reset: "Reset",
    pinyin: "Pinyin line",
    pinyinDesc: "A small pinyin line under the lyric",
    tones: "Tone marks",
    tonesDesc: "shī háng instead of shi hang",
    groupWords: "Group Pinyin by word",
    groupWordsDesc: "Syllables of one detected word stay together",
    debug: "Debug logging",
    debugDesc: "Verbose logs in the console and kashiyomi.log",
    preview: "Preview",
    about: "About",
    aboutRepo: "GitHub repository",
    aboutLog: "Log file",
    zhFont: "Chinese font on Chinese text",
    zhFontDesc: "Chinese lyrics, and Chinese translation lines under foreign lyrics",
    zhFontStack: "Chinese font stack",
    sectionAi: "AI translation",
    aiAuto: "Translate songs automatically",
    aiAutoDesc: "One request per song, shown below the original like the built-in translation; needs your own API key",
    aiProvider: "Provider",
    aiProviderDesc: "OpenAI-compatible covers OpenAI, DeepSeek, OpenRouter, Ollama and more",
    aiBaseUrl: "Base URL",
    aiBaseUrlDesc: "OpenAI-compatible endpoint",
    aiApiKey: "API key",
    aiApiKeyDesc: "Stored locally, sent only to the endpoint you configure",
    aiModel: "Model",
    aiModelDesc: "e.g. gpt-4o-mini or gemini-3.5-flash-lite",
    aiTargetLang: "Target language",
    aiTargetLangDesc: "Any language name the model understands",
    aiCustomPrompt: "Extra instructions",
    aiCustomPromptDesc: "Optional style guidance added to the prompt",
  },
  zh: {
    analyzerReady: "分析器就绪",
    analyzerLoading: "词典加载中",
    analyzerNotStarted: "分析器未启动",
    analyzerFailed: "分析器加载失败",
    reannotate: "重新标注",
    sectionJapanese: "日语",
    sectionChinese: "中文",
    sectionAdvanced: "高级",
    furigana: "振假名",
    furiganaDesc: "在汉字上方显示读音",
    romaji: "罗马音行",
    romajiDesc: "在歌词下方显示一行小号罗马音",
    hints: "读音提示",
    hintsDesc: "识别歌词自带的读音，如 天(そら)，以不同颜色显示",
    repair: "汉字修复",
    repairDesc: "修复日语歌词中的中文字形，如 梦见ては 显示为 夢見ては",
    furiganaSize: "振假名大小",
    furiganaSizeDesc: "相对歌词文字的读音大小",
    jpFont: "日语歌词使用日文字体",
    jpFontDesc: "同一个汉字可能渲染成中文字形，强制使用日文字体",
    fontStack: "日文字体栈",
    fontStackDesc: "已安装的字体，从首选到回退",
    reset: "重置",
    pinyin: "拼音行",
    pinyinDesc: "在歌词下方显示一行小号拼音",
    tones: "声调标注",
    tonesDesc: "shī háng 而不是 shi hang",
    groupWords: "按词分组拼音",
    groupWordsDesc: "同一个词的音节保持在一起",
    debug: "调试日志",
    debugDesc: "在控制台和 kashiyomi.log 输出详细日志",
    preview: "预览",
    about: "关于",
    aboutRepo: "GitHub 仓库",
    aboutLog: "日志文件",
    zhFont: "中文文本使用中文字体",
    zhFontDesc: "中文歌词，以及外语歌词下的中文翻译行",
    zhFontStack: "中文字体栈",
    sectionAi: "AI 翻译",
    aiAuto: "自动翻译歌曲",
    aiAutoDesc: "每首歌一次请求，像内置翻译一样显示在原文下方，需要自己的 API key",
    aiProvider: "服务商",
    aiProviderDesc: "OpenAI 兼容接口覆盖 OpenAI、DeepSeek、OpenRouter、Ollama 等",
    aiBaseUrl: "Base URL",
    aiBaseUrlDesc: "OpenAI 兼容接口地址",
    aiApiKey: "API key",
    aiApiKeyDesc: "仅保存在本地，只发送到你配置的接口",
    aiModel: "模型",
    aiModelDesc: "如 gpt-4o-mini 或 gemini-3.5-flash-lite",
    aiTargetLang: "目标语言",
    aiTargetLangDesc: "模型能理解的任意语言名称",
    aiCustomPrompt: "额外指示",
    aiCustomPromptDesc: "可选的风格指导，会附加到提示词中",
  },
} as const;

export type StringKey = keyof (typeof STRINGS)["en"];

export function panelLang(): PanelLang {
  const stored = getSettings().panelLang;
  if (stored === "en" || stored === "zh") return stored;
  return typeof navigator !== "undefined" && navigator.language?.startsWith("zh") ? "zh" : "en";
}

export function setPanelLang(lang: PanelLang): void {
  updateSettings({ panelLang: lang });
}

export function t(key: StringKey): string {
  return STRINGS[panelLang()][key];
}
