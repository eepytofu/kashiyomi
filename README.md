# Kashiyomi（歌詞読み）

English | [简体中文](README.zh-CN.md)

A [BetterNCM](https://github.com/std-microblock/BetterNCM) plugin that adds furigana, romaji, pinyin, and optional AI translation directly to the native lyrics page.

![一梦红尘](previews/一梦红尘.avif)

## Features

- First run offers the Core (about 217 MB installed) and Full (about 360 MB installed) Japanese dictionaries, with Core selected by default. One edition is kept outside the plugin folder so reinstalling the plugin does not fetch it again.
- Furigana above kanji and romaji below Japanese lyrics, generated locally with [sudachi.rs](https://github.com/WorksApplications/sudachi.rs) and SudachiDict. Unknown readings are left unchanged.
- Lyric-provided readings can override the dictionary. For example, `天(そら)` is displayed as `天` with `そら` as its furigana and romaji reading. Authored readings use a different color from inferred readings.
- Local reading overrides can be added as `word=reading` entries for names or lyric-specific readings the dictionary cannot choose correctly.
- Pinyin below Chinese lyrics, generated with [Pinyin Pro](https://github.com/zh-lx/pinyin-pro) and its complete dictionary. Tone marks and word grouping can be toggled separately.
- Optional AI translation below the original lyrics. It supports Gemini and OpenAI-compatible `chat/completions` endpoints, with configurable models, target languages, base URLs, and extra instructions. When enabled, the selected provider receives the song title, artist, original lyric lines, target language, and instructions; the API key authenticates that request. Settings, keys, and up to 500 cached translations stay in the local browser profile. Multiple keys can be used for automatic fallback.
- Separate font stacks for Japanese and Chinese text to avoid incorrect glyph forms caused by [Han Unification](https://heistak.github.io/your-code-displays-japanese-wrong/). The Chinese font also applies to NCM's Chinese translation rows.

### QoL

- Simplified Chinese forms used in Japanese lyrics can be repaired before annotation, so `梦见ては` is displayed as `夢見ては`.
- Japanese and Chinese are detected per line in mixed-language songs.
- Katakana okurigana, such as `夜ニ紛レ`, is normalized only during analysis. The displayed lyric stays unchanged.
- Production credits are skipped by default, while standalone singer and section markers are always ignored. Readings for credit lines can be enabled.
- Copying lyrics excludes the furigana, romaji, pinyin, and translation rows added by Kashiyomi.
- Furigana size is adjustable, and the settings panel is available in English and Simplified Chinese.

## Status

Early development. It works on the songs I test, but mixed-language routing and uncommon readings can still be wrong.

There are no packaged releases yet.

## Build and install from source

Requirements:

* NetEase Cloud Music 3.x with BetterNCM
* Node.js 26 or newer
* A stable Rust toolchain with the MSVC target

Quit NetEase Cloud Music completely before installation, including the tray process.

```powershell
git clone https://github.com/eepytofu/kashiyomi.git
cd kashiyomi
npm ci
npm run fetch-dict
npm run export-pinyin
npm run export-jmdict
npm run build
cd native
cargo build --release
cd ..
npm run dev-install
```

`npm run fetch-dict` downloads SudachiDict Core, about 217 MB installed, so a development build has one without going through the first-run download. Pass `full` to fetch the roughly 360 MB Full edition. The plugin can install and switch between either edition while keeping only one active. `npm run export-pinyin` prepares Pinyin Pro's complete dictionary, and `npm run export-jmdict` builds the roughly 7 MB JMdict reading table used to fill readings the analyzer cannot supply.

By default, `npm run dev-install` installs Kashiyomi to `C:\betterncm\plugins_dev\Kashiyomi`. To use another directory:

```powershell
npm run dev-install -- "D:/path/to/plugins_dev/Kashiyomi"
```

Restart NetEase Cloud Music after installation.

## Development

```powershell
npm test
npm run typecheck
cd native
cargo test
```

## Credits

- [sudachi.rs](https://github.com/WorksApplications/sudachi.rs) and [SudachiDict](https://github.com/WorksApplications/SudachiDict) (Apache-2.0) for Japanese analysis.
- [Pinyin Pro](https://github.com/zh-lx/pinyin-pro) and [opencc-js](https://github.com/nk2028/opencc-js) for Chinese readings and simplified-form repair.
- [InfLink-rs](https://github.com/apoint123/inflink-rs) for showing how a Rust native plugin talks to BetterNCM.
- [Furigana-api-fixed](https://github.com/Hxjjxg/Furigana-api-fixed) and [MuttonString/Furigana](https://github.com/MuttonString/Furigana) as prior work on annotating NCM lyrics.
- My [spicy-lyrics fork](https://github.com/eepytofu/spicy-lyrics) for earlier versions of many of these features.

## License

[GNU Affero General Public License v3.0](LICENSE)
