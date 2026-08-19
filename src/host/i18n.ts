// Panel UI strings. English and Simplified Chinese; the default follows the
// page locale (NCM is usually zh-CN) until the user picks one.

import { getSettings, updateSettings } from "./settings.ts";

export type PanelLang = "en" | "zh";

const STRINGS = {
  en: {
    // On the dictionary row, not a status bar: the row owns what is on disk,
    // and whether the analyzer opened it belongs beside that rather than in a
    // second sentence somewhere else.
    dictAnalyzerLoading: "loading",
    dictAnalyzerFailed: "failed to load",
    reannotate: "Re-annotate",
    sectionJapanese: "Japanese",
    sectionChinese: "Chinese",
    sectionFonts: "Fonts",
    sectionAdvanced: "Advanced",
    credits: "Annotate credit lines",
    creditsDesc: "Lines like 作词: or 编曲：. Translation always skips them",
    furigana: "Furigana",
    furiganaDesc: "",
    romaji: "Romaji line",
    romajiDesc: "",
    hints: "Reading hints",
    hintsDesc: "Use readings the lyric itself provides, like 天(そら); colored to tell them from dictionary readings",
    repair: "Kanji repair",
    repairDesc: "Fix Chinese glyph forms in Japanese lyrics, like 梦见てる to 夢見てる. Readings work either way",
    furiganaSize: "Furigana size",
    furiganaSizeDesc: "Reading size relative to the lyric text",
    jpFont: "Japanese font on Japanese lyrics",
    jpFontDesc: "",
    fontStack: "Japanese font stack",
    fontStackDesc: "Installed fonts, first choice to fallback",
    reset: "Reset",
    pinyin: "Pinyin line",
    pinyinDesc: "",
    tones: "Tone marks",
    tonesDesc: "shī háng instead of shi hang",
    groupWords: "Group Pinyin by word",
    groupWordsDesc: "",
    dictionary: "Japanese dictionary",
    dictNotInstalled: "not installed",
    dictEditionCore: "Core",
    dictEditionCoreDesc: "Recommended. Basic vocabulary, smaller download and faster startup.",
    dictEditionFull: "Full",
    dictEditionFullDesc: "Adds proper names and specialist terms; uses substantially more disk and memory.",
    dictEditionInUse: "in use",
    dictManage: "Manage",
    dictSetUp: "Set up",
    // Shown over the settings that do nothing until a dictionary is installed.
    dictNeededForThese: "Greyed settings need the Japanese dictionary.",
    setupNeedsDictionary:
      "Only the Japanese dictionary is set up here. AI translation needs your own API key, and everything else is in the settings panel.",
    setupInstalled: "Dictionary installed. Japanese lyrics will show readings from now on.",
    setupDone: "Done",
    setupSpace: "needs {needed} free, you have {free}",
    // Not "Later": everything except Japanese readings already works, so
    // deferring the dictionary is continuing rather than postponing the plugin.
    setupLater: "Skip for now",
    setupClose: "Close",
    dictInstall: "Download",
    dictDownloading: "downloading",
    dictInstalling: "verifying and installing…",
    // One line per install phase, because they take very different amounts of
    // time: hashing and unpacking are minutes on a slow disk, the swap is
    // instant. A single label would leave the long ones looking stuck.
    dictVerifying: "checking the download",
    dictUnpacking: "unpacking",
    dictActivating: "activating",
    dictUpdate: "Update",
    dictSwitch: "Switch",
    dictUpToDate: "already the newest release",
    dictCheckedJustNow: "checked just now",
    dictUpdateAvailable: "update available",
    dictInstalledState: "installed",
    dictChecking: "checking for the latest release",
    dictUpdateCheckFailed: "could not check for updates",
    dictCancel: "Cancel",
    // The button says what is happening, not what it will do when it stops. It
    // used to keep reading "Update" for the whole install.
    dictWorkChecking: "Checking…",
    dictWorkInstalling: "Installing…",
    // Free space, not download size: the archive and its extraction exist at
    // once, so 68.9 MB of download needs about 340 MB free.
    dictNoSpace: (needed: string) => `not enough disk space, ${needed} free required`,
    // Shown on the lyrics page itself when a Japanese line has no dictionary to
    dictNoticeMissing:
      "No Japanese dictionary installed. Download it in Kashiyomi settings, or turn this notice off there.",
    lyricDictNotice: "Missing dictionary notice",
    lyricDictNoticeDesc: "Show a line on Japanese lyrics while no dictionary is installed",
    dictRetry: "Retry",
    dictFailed: "failed",
    dictFail_offline: "could not reach the download",
    dictFail_no_source: "no source answered",
    dictFail_checksum: "the download was corrupt",
    dictFail_disk_space: "not enough disk space",
    dictFail_extract: "could not unpack the download",
    dictFail_load: "the analyzer could not load it",
    dictFail_cancelled: "cancelled",
    debug: "Debug logging",
    debugDesc: "Verbose logs in the console and kashiyomi.log",
    panelLanguage: "Panel language",
    // Hover text on the unlabelled EN/中文 toggle, so it has to say what the
    // control changes as well as what it leaves alone. Trimmed to the second
    // half once and that left a tooltip explaining only what it does not do.
    panelLanguageDesc: "Language of this panel only. Does not affect lyrics or translation",
    preview: "Preview",
    about: "About",
    aboutRepo: "GitHub repository",
    aboutIssues: "Report an issue",
    aboutLog: "Log file",
    zhFont: "Chinese font on Chinese text",
    zhFontDesc: "Chinese lyrics, and Chinese translation lines under foreign lyrics",
    zhFontStack: "Chinese font stack",
    rowFont: "Reading row font",
    rowFontDesc: "Romaji, pinyin and non-CJK translation rows",
    rowFontStack: "Reading row font stack",
    sectionAi: "Translation",
    aiAuto: "Translate songs automatically",
    aiAutoDesc: "One request per song; needs your own API key",
    aiProvider: "Provider",
    aiProviderDesc: "OpenAI-compatible covers OpenAI, DeepSeek, OpenRouter, Ollama and more",
    aiBaseUrl: "Base URL",
    aiBaseUrlDesc: "",
    aiApiKey: "API keys",
    aiApiKeyDesc: "One per line; if a key is rate limited the next one is used",
    aiModel: "Model",
    aiModelDesc: "e.g. gpt-5.6-luna or gemini-3.5-flash-lite",
    aiTargetLang: "Target language",
    aiTargetLangDesc: "",
    aiCustomPrompt: "Extra instructions",
    readingOverrides: "Your own readings",
    readingOverridesDesc:
      "One per line, word=reading, e.g. 春風=はるかぜ. Overrides the dictionary; a reading written into the lyric still wins.",
    aiCustomPromptDesc: "Layered on top of the built-in prompt; wins on style, never on the output format",
    customOption: "Custom…",
    aiClearCache: "Cached translations",
    aiClearCacheDesc: "",
    clear: "Clear",
    cleared: "Cleared",
    songsCached: (n: number) => (n === 1 ? "1 song stored" : `${n} songs stored`),
  },
  zh: {
    dictAnalyzerLoading: "加载中",
    dictAnalyzerFailed: "加载失败",
    reannotate: "重新标注",
    sectionJapanese: "日语",
    sectionChinese: "中文",
    sectionFonts: "字体",
    sectionAdvanced: "高级",
    credits: "为制作信息注音",
    creditsDesc: "作词:、编曲： 这类行。翻译始终会跳过它们",
    furigana: "振假名",
    furiganaDesc: "",
    romaji: "罗马音行",
    romajiDesc: "",
    hints: "读音提示",
    hintsDesc: "识别歌词自带的读音，如 天(そら)；以不同颜色与词典读音区分",
    repair: "汉字修复",
    repairDesc: "修复日语歌词中的中文字形，如 梦见てる 显示为 夢見てる。无论开关，读音都会显示",
    furiganaSize: "振假名大小",
    furiganaSizeDesc: "相对歌词文字的读音大小",
    jpFont: "日语歌词使用日文字体",
    jpFontDesc: "",
    fontStack: "日文字体栈",
    fontStackDesc: "已安装的字体，从首选到回退",
    reset: "重置",
    pinyin: "拼音行",
    pinyinDesc: "",
    tones: "声调标注",
    tonesDesc: "shī háng 而不是 shi hang",
    groupWords: "按词分组拼音",
    groupWordsDesc: "",
    dictionary: "日语词典",
    dictNotInstalled: "未安装",
    dictEditionCore: "Core",
    dictEditionCoreDesc: "推荐。基础词汇，下载更小，启动更快。",
    dictEditionFull: "Full",
    dictEditionFullDesc: "增加专有名词和专业词汇；需要更多磁盘与内存。",
    dictEditionInUse: "使用中",
    dictManage: "管理",
    dictSetUp: "设置",
    dictNeededForThese: "灰色的设置需要日语词典。",
    setupNeedsDictionary:
      "此处仅设置日语词典。AI 翻译需自备 API key，其余设置均在设置面板中。",
    setupInstalled: "词典已安装，之后日语歌词将显示读音。",
    setupDone: "完成",
    setupSpace: "需要 {needed} 可用空间，当前可用 {free}",
    setupLater: "暂时跳过",
    setupClose: "关闭",
    dictInstall: "下载",
    dictDownloading: "下载中",
    dictInstalling: "校验并安装中…",
    dictVerifying: "正在校验下载文件",
    dictUnpacking: "正在解压",
    dictActivating: "正在启用",
    dictUpdate: "更新",
    dictSwitch: "切换",
    dictUpToDate: "已是最新版本",
    dictCheckedJustNow: "刚刚检查过",
    dictUpdateAvailable: "有可用更新",
    dictInstalledState: "已安装",
    dictChecking: "正在检查最新版本",
    dictUpdateCheckFailed: "无法检查更新",
    dictCancel: "取消",
    dictWorkChecking: "检查中…",
    dictWorkInstalling: "安装中…",
    dictNoSpace: (needed: string) => `磁盘空间不足，需要 ${needed} 可用空间`,
    dictNoticeMissing: "尚未安装日语词典，请在 Kashiyomi 设置中下载，也可在那里关闭此提示。",
    lyricDictNotice: "缺少词典提示",
    lyricDictNoticeDesc: "未安装日语词典时，在日语歌词上显示一行提示",
    dictRetry: "重试",
    dictFailed: "失败",
    dictFail_offline: "无法连接下载源",
    dictFail_no_source: "没有可用的下载源",
    dictFail_checksum: "下载的文件已损坏",
    dictFail_disk_space: "磁盘空间不足",
    dictFail_extract: "无法解压下载的文件",
    dictFail_load: "分析器无法加载",
    dictFail_cancelled: "已取消",
    debug: "调试日志",
    debugDesc: "在控制台和 kashiyomi.log 输出详细日志",
    panelLanguage: "面板语言",
    panelLanguageDesc: "仅影响此面板的语言，不影响歌词与翻译",
    preview: "预览",
    about: "关于",
    aboutRepo: "GitHub 仓库",
    aboutIssues: "反馈问题",
    aboutLog: "日志文件",
    zhFont: "中文文本使用中文字体",
    zhFontDesc: "中文歌词，以及外语歌词下的中文翻译行",
    zhFontStack: "中文字体栈",
    rowFont: "注音行字体",
    rowFontDesc: "罗马音、拼音，以及非中日文的翻译行",
    rowFontStack: "注音行字体栈",
    sectionAi: "AI 翻译",
    aiAuto: "自动翻译歌曲",
    aiAutoDesc: "每首歌一次请求，需要自己的 API key",
    aiProvider: "服务商",
    aiProviderDesc: "OpenAI 兼容接口覆盖 OpenAI、DeepSeek、OpenRouter、Ollama 等",
    aiBaseUrl: "Base URL",
    aiBaseUrlDesc: "",
    aiApiKey: "API key",
    aiApiKeyDesc: "每行一个，某个 key 触发限流时会自动换用下一个",
    aiModel: "模型",
    aiModelDesc: "如 gpt-5.6-luna 或 gemini-3.5-flash-lite",
    aiTargetLang: "目标语言",
    aiTargetLangDesc: "",
    aiCustomPrompt: "额外指示",
    readingOverrides: "自定义读音",
    readingOverridesDesc:
      "每行一个，词=读音，如 春風=はるかぜ。优先于词典；歌词中自带的读音仍然优先。",
    aiCustomPromptDesc: "叠加在内置提示词之上，风格上优先，但不改变输出格式",
    customOption: "自定义…",
    aiClearCache: "翻译缓存",
    aiClearCacheDesc: "",
    clear: "清除",
    cleared: "已清除",
    songsCached: (n: number) => `已缓存 ${n} 首`,
  },
} as const;

type AllKeys = keyof (typeof STRINGS)["en"];
export type StringKey = {
  [K in AllKeys]: (typeof STRINGS)["en"][K] extends string ? K : never;
}[AllKeys];

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

export function tSongsCached(count: number): string {
  return STRINGS[panelLang()].songsCached(count);
}

export function tNoSpace(needed: string): string {
  return STRINGS[panelLang()].dictNoSpace(needed);
}
