# Kashiyomi（歌詞読み）

English | [简体中文](README.zh-CN.md)

A [BetterNCM](https://github.com/std-microblock/BetterNCM) plugin for NetEase Cloud Music that adds readings on top of the normal lyrics page. It annotates the lyrics NCM already shows instead of replacing them with its own player.

![刹那芳华](previews/刹那芳华.avif)

![一梦红尘](previews/一梦红尘.avif)

## What it does

Readings are generated on your machine. No account, no reading service, nothing leaves the app. AI translation is the one exception, and it is off until you add your own API key: when it runs, the lyrics of the current song go to the endpoint you configured.

- Furigana above kanji and a romaji line under Japanese lyrics, analyzed locally with [Sudachi](https://github.com/WorksApplications/sudachi.rs) and its full dictionary.
- Japanese lyrics can include reading hints such as 天(そら). The そら in parentheses is hidden from the main line, then used as the furigana and as the basis for romaji. Source-provided readings use a different color from inferred ones.
- Pinyin under Chinese lyrics with [Pinyin Pro](https://github.com/zh-lx/pinyin-pro)'s complete dictionary, with optional tone marks and word-based Pinyin spacing (syllables that belong to one detected Mandarin word stay together).
- Kanji repair for Japanese lyrics that were stored with Chinese glyph forms, so 梦见ては displays as 夢見ては.
- Songs that mix Japanese and Chinese are handled line by line, so a Chinese line inside a Japanese song gets pinyin instead of being read as kanji.
- AI translation below the original line, like the built-in translation. Works with an OpenAI-compatible endpoint or Gemini and needs your own API key.

## Status

Early development. Nothing usable yet.

## Install from source

There are no packaged releases yet. You need NetEase Cloud Music 3.x with BetterNCM, Node.js 20.11 or newer, and a stable Rust toolchain (MSVC).

```powershell
git clone https://github.com/eepytofu/kashiyomi.git
cd kashiyomi
npm ci
npm run fetch-dict
npm run build
cd native
cargo build --release
```

`npm run fetch-dict` downloads the Sudachi dictionary (about 360 MB) into `assets/dict`. Proper install and packaging instructions will come once the plugin actually works.

## Development

```powershell
npm test
cd native
cargo test
```

## Credits

- [sudachi.rs](https://github.com/WorksApplications/sudachi.rs) and [SudachiDict](https://github.com/WorksApplications/SudachiDict) (Apache-2.0) for Japanese analysis.
- [Pinyin Pro](https://github.com/zh-lx/pinyin-pro) and [opencc-js](https://github.com/nk2028/opencc-js) for Chinese readings and conversion.
- [InfLink-rs](https://github.com/apoint123/inflink-rs) for showing how a Rust native plugin talks to BetterNCM.
- [Furigana-api-fixed](https://github.com/Hxjjxg/Furigana-api-fixed) and [MuttonString/Furigana](https://github.com/MuttonString/Furigana) as prior art for annotating NCM's lyrics.
- My [spicy-lyrics fork](https://github.com/eepytofu/spicy-lyrics) (Spicetify), where most of these features were first built.

## License

[GNU Affero General Public License v3.0](LICENSE)
