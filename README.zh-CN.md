# Kashiyomi（歌詞読み）

[English](README.md) | 简体中文

一个直接在网易云原生歌词页上添加振假名、罗马音、拼音和可选 AI 翻译的 [BetterNCM](https://github.com/std-microblock/BetterNCM) 插件。

![一梦红尘](previews/一梦红尘.avif)

## 功能

- 首次运行时可选择 Core（安装后约 207 MB）或 Full（安装后约 343 MB）日语词典，默认选择 Core。两个版本可以同时保留，但同一时间只启用一个；可在 Kashiyomi 设置中切换或移除任一版本。
- 词典不会随插件打包，而是在运行时下载并保存在插件目录之外，因此重装 Kashiyomi 会直接复用现有文件。Core 依次尝试 WorksApplications 官方 CloudFront、清华 PyPI 镜像和 PyPI；Full 依次尝试 CloudFront 和 GitHub Releases。只有 Kashiyomi 新版本内置经过审核的新固定版本时才会提示更新，不会实时查询“最新版”。
- 在日语歌词的汉字上方显示振假名，并在下方显示罗马音。读音由本地的 [sudachi.rs](https://github.com/WorksApplications/sudachi.rs) 和 SudachiDict 生成，无法识别的部分会保留原样。
- 支持歌词自带的读音提示。例如 `天(そら)` 会显示为 `天`，并使用 `そら` 作为振假名和罗马音。歌词原有读音会用不同颜色标出。
- 可通过 `词=读音` 格式添加本地读音覆盖，用于词典无法正确判断的人名或歌词特定读音。
- 在中文歌词下方显示由 [Pinyin Pro](https://github.com/zh-lx/pinyin-pro) 完整词典生成的拼音。声调符号和按词连写可以分别开关。
- 在原文下方显示可选的 AI 翻译。支持 Gemini 和 OpenAI 兼容的 `chat/completions` 接口，可设置模型、目标语言、Base URL 和额外指令。启用后，所选服务商会收到歌曲标题、歌手、原始歌词行、目标语言和指令，API key 用于验证该请求。设置、key 以及最多 500 首缓存翻译保存在本地浏览器配置中，也可以填写多个 key 以自动切换。
- 日语和中文可以使用不同的字体栈，避免[汉字统一](https://heistak.github.io/your-code-displays-japanese-wrong/)导致的错误字形。中文字体也会应用到网易云自带的中文翻译行。

### 细节优化

- 修复日语歌词中误用的简体字，例如将 `梦见ては` 显示为 `夢見ては`。
- 日中混排歌曲会按行判断语言。
- `夜ニ紛レ` 这类片假名送假名只会在分析时临时转换，显示内容不会改变。
- 制作信息默认不注音，单独一行的演唱者和段落标记会直接跳过。需要时可以为制作信息开启注音。
- 复制歌词时不会带上 Kashiyomi 添加的振假名、罗马音、拼音和翻译行。
- 振假名大小可调，设置面板提供英文和简体中文。

## 状态

项目仍处于早期开发阶段。目前在我测试的歌曲上可以正常使用，但日中混排判断和少见读音仍可能出错。

目前没有打包发布版本。

## 从源码构建并安装

需要以下环境：

* 安装了 BetterNCM 的网易云音乐 3.x
* Node.js 26 或更高版本
* 稳定版 Rust 工具链（MSVC）

安装前请完全退出网易云音乐，包括托盘进程。

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

`npm run fetch-dict` 会下载安装后约 207 MB 的 SudachiDict Core，让开发版本无需经过首次运行下载即可使用；传入 `full` 可下载安装后约 343 MB 的 Full 版本。运行时安装使用上文所述的内置审核清单；开发阶段下载的词典不会进入插件包。`npm run export-pinyin` 会生成 Pinyin Pro 的完整词典文件，`npm run export-jmdict` 会生成用于补全分析器无法给出的读音的 JMdict 读音表（约 7 MB）。

`npm run dev-install` 默认将 Kashiyomi 安装到 `C:\betterncm\plugins_dev\Kashiyomi`。如需使用其他目录：

```powershell
npm run dev-install -- "D:/path/to/plugins_dev/Kashiyomi"
```

安装完成后，请重新启动网易云音乐。

## 开发

```powershell
npm test
npm run typecheck
cd native
cargo test
```

## 鸣谢

- [sudachi.rs](https://github.com/WorksApplications/sudachi.rs) 与 [SudachiDict](https://github.com/WorksApplications/SudachiDict)（Apache-2.0），用于日语分析。
- [Pinyin Pro](https://github.com/zh-lx/pinyin-pro) 与 [opencc-js](https://github.com/nk2028/opencc-js)，用于中文注音和简体字修复。
- [InfLink-rs](https://github.com/apoint123/inflink-rs)，提供了 Rust 原生插件与 BetterNCM 对接的参考实现。
- [Furigana-api-fixed](https://github.com/Hxjjxg/Furigana-api-fixed) 与 [MuttonString/Furigana](https://github.com/MuttonString/Furigana)，网易云歌词注音的先行项目。
- 我的 [spicy-lyrics fork](https://github.com/eepytofu/spicy-lyrics)，其中包含这些功能的早期实现。

## 许可证

[GNU Affero General Public License v3.0](LICENSE)
