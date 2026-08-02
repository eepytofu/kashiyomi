# Kashiyomi（歌詞読み）

[English](README.md) | 简体中文

一个在网易云音乐原生歌词页上添加注音的 [BetterNCM](https://github.com/std-microblock/BetterNCM) 插件。它直接在网易云已经显示的歌词上做标注，不会另外创建或替换播放页面。

![刹那芳华](previews/刹那芳华.avif)

![一梦红尘](previews/一梦红尘.avif)

## 功能

注音全部在本机生成，不需要账号，不经过任何注音服务。AI 翻译是唯一的例外，并且在你填入自己的 API key 之前不会启用：启用后，当前歌曲的歌词会发送到你配置的接口。

- 日语歌词的汉字上方显示振假名，下方显示一行小号罗马音，由本地的 [Sudachi](https://github.com/WorksApplications/sudachi.rs) 完整词典分析。
- 识别歌词自带的读音提示，例如 天(そら)：括号里的 そら 会从正文隐藏，用作这个词的振假名和罗马音。歌词自带的读音和自动推断的读音会以不同颜色显示。
- 中文歌词下方显示拼音，使用 [Pinyin Pro](https://github.com/zh-lx/pinyin-pro) 的完整词典，可选声调标注和按词分组（同一个词的音节保持在一起）。
- 汉字修复：使用中文汉字字形的日语歌词可以正确显示，例如 梦见ては 显示为 夢見ては。
- 日中混排的歌曲按行处理，日语歌曲里的中文行会显示拼音，而不会被当成日语汉字来注音。即使是缺少明显现代汉语特征的文言句子，也能正确识别。
- 歌词开头的制作信息（作詞:、编曲：、Vocal: 等）会被识别并跳过，不会被注音，也不会被翻译。
- AI 翻译显示在原文下方，与内置翻译的样式类似。支持 OpenAI 兼容接口或 Gemini，需要自己的 API key。每首歌只发送一次请求，结果按歌曲缓存，并且不会覆盖网易云自带的翻译。可以每行填一个 key，某个 key 触发限流时会自动换用下一个。
- 同一个汉字可能显示成中文或日文字形（[汉字统一](https://heistak.github.io/your-code-displays-japanese-wrong/)），因此可以分别为日语行和中文文本设置字体，中文文本也包括外语歌曲下方的中文翻译行。
- 振假名大小可调，设置面板提供英文和简体中文两种语言。

## 状态

早期开发中。在我自己的设备和我常听的歌上可以正常使用，其他情况可能还有问题。

## 从源码安装

目前没有打包发布。你需要装有 BetterNCM 的网易云音乐 3.x、Node.js 20.11 或更高版本，以及稳定版 Rust 工具链（MSVC）。

```powershell
git clone https://github.com/eepytofu/kashiyomi.git
cd kashiyomi
npm ci
npm run fetch-dict
npm run build
cd native
cargo build --release
```

`npm run fetch-dict` 会下载 Sudachi 词典（约 360 MB）到 `assets/dict`。等插件真正可用后会补充正式的安装和打包说明。

## 开发

```powershell
npm test
cd native
cargo test
```

## 鸣谢

- [sudachi.rs](https://github.com/WorksApplications/sudachi.rs) 与 [SudachiDict](https://github.com/WorksApplications/SudachiDict)（Apache-2.0），日语形态分析。
- [Pinyin Pro](https://github.com/zh-lx/pinyin-pro) 与 [opencc-js](https://github.com/nk2028/opencc-js)，中文注音与转换。
- [InfLink-rs](https://github.com/apoint123/inflink-rs)，展示了 Rust 原生插件与 BetterNCM 的对接方式。
- [Furigana-api-fixed](https://github.com/Hxjjxg/Furigana-api-fixed) 与 [MuttonString/Furigana](https://github.com/MuttonString/Furigana)，网易云歌词注音的先行者。
- 我的 [spicy-lyrics fork](https://github.com/eepytofu/spicy-lyrics)（Spicetify），这些功能最初是在该项目中实现的。

## 许可证

[GNU Affero General Public License v3.0](LICENSE)
