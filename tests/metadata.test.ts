import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  hasCreditShape,
  isCopyrightNotice,
  isCreditLine,
  isPartMarkerLine,
} from "../src/engine/metadata.ts";

test("detects the credits a japanese song actually ships with", () => {
  // Captured from the running app on 2026-08-03. NetEase writes the role
  // labels in **simplified** even for Japanese songs: 無 (立入禁止), 千本桜
  // (黒うさP) and Bad Apple!! all open with 作词/作曲/编曲, never 作詞/編曲.
  // An earlier version of this fixture paired the real artist with role
  // spellings NetEase was not observed to serve.
  for (const line of [
    "作词: 立入禁止",
    "作曲: 立入禁止",
    "编曲: 立入禁止",
    "作词: 黒うさP",
    "编曲: ビートまりお / Masayoshi Minoshima / まらしぃ",
  ]) {
    assert.equal(isCreditLine(line), true, line);
  }
});

test("japanese role spellings are still accepted", () => {
  // Not observed from NetEase, but lyrics can be uploaded by anyone and the
  // kanji forms cost nothing to keep. Labelled so nobody reads this as
  // evidence of what the app serves.
  for (const line of ["作詞: 立入禁止", "編曲: 立入禁止", "唄：歌爱ユキ"]) {
    assert.equal(isCreditLine(line), true, line);
  }
});

test("detects non-role japanese credit labels", () => {
  for (const line of ["ミックス: someone", "イラスト：絵師"]) {
    assert.equal(isCreditLine(line), true, line);
  }
});

test("detects chinese credits, including numbered ones", () => {
  for (const line of [
    "作曲：胡多多",
    "编曲：包达",
    "表演者：洛天依",
    "9. 导唱协力：小缘",
    "10. 出品：哔哩哔哩拜年纪",
    "调校：某人",
    "特别感谢：大家",
  ]) {
    assert.equal(isCreditLine(line), true, line);
  }
});

test("a slash-separated label may contain a concatenated role", () => {
  // 洛阳怀, from the routed-chinese list in kashiyomi.log 2026-08-05. 编曲 is a
  // table entry; 和声编写 is 和声 + 编写 run together. Requiring every
  // slash-separated part to be a *direct* table hit dropped the whole line, so
  // it was annotated with pinyin and sent to the translator as a lyric.
  assert.equal(isCreditLine("编曲/和声编写：PoKeR"), true);
  assert.equal(isCreditLine("编曲/和声编写:PoKeR"), true);
  // The concatenation on its own already worked. Pinned so the two paths cannot
  // drift apart again. 惊鹊, read off a screenshot of the running app.
  assert.equal(isCreditLine("和声编写：雾敛"), true);
});

test("a label spaced between characters is still one label", () => {
  // Uploads sometimes space CJK labels out. Stripping matters more than it
  // looks under a ratio: 作 词 作 曲 is seven characters of which four are
  // covered, so unstripped it scores 0.57 and falls under the threshold, while
  // stripped it is 1.00. Caught by `metadata/drop-space-strip`, which survived
  // until this existed — every other spaced label in the suite is English,
  // where the words are long enough that the stray space barely moves the
  // ratio ("Composed by" is 0.91 either way).
  assert.equal(isCreditLine("作 词 作 曲：某人"), true);
  assert.equal(isCreditLine("作 词：某人"), true);
});

test("a compound role is recognized without being listed", () => {
  // Every one of these was a reported miss under the old whole-label table, and
  // not one of them is an entry now either — they are covered by their pieces.
  // 女声 is 女 + 声; 录音室 is 录音 with 室 left over; 企划题字 is 企划 + 题字.
  for (const line of [
    "女声: Laurie",
    "录音室: Dark Horse Studio",
    "分轨：向往",
    "插画：RedMatcha",
    "设计：马睿",
    "企划题字：毫克",
    "和声编写：雾敛",
    "混音师：某人",
  ]) {
    assert.equal(isCreditLine(line), true, line);
  }
});

test("the cover threshold is inclusive, and 录音室 sits exactly on it", () => {
  // 录音 covers two of three characters. This is the label the threshold was
  // derived from, so if the comparison ever becomes exclusive it is the first
  // thing to break — and it would break silently, back into the behaviour this
  // replaced.
  assert.equal(isCreditLine("录音室：某人"), true);
  // One character further from a role and it is not a label any more. Both of
  // these are two thirds *uncovered*.
  assert.equal(isCreditLine("录音室外：某人"), false);
  assert.equal(isCreditLine("声嘶力竭：还是喊了"), false);
});

test("a speaker label is not a role, however role-shaped its characters are", () => {
  // 人 is not a morpheme in the table, so these score 0.50 and stay lyrics. It
  // was one, and 女人/男人/主人 all came back as credits at 1.00 — which in a
  // song with spoken parts drops the speaker line *and the dialogue on it*.
  // The 声 compounds beside them are what 人 was there to reach, and they are
  // reached without it.
  for (const line of ["女人：你要去哪", "男人：我不知道", "主人：请进"]) {
    assert.equal(isCreditLine(line), false, line);
  }
  for (const line of ["女声：某人", "男声：某人", "童声：某人", "人声：某人"]) {
    assert.equal(isCreditLine(line), true, line);
  }
});

test("detects english credits", () => {
  // No captured song has ever shipped an English credit label — 白马过了离原's
  // 11-line block, 下等马, 洛阳怀 and 太成都 are all Chinese labels, with Latin
  // only ever in the value (编曲: Fsy小诺). Kept anyway, and labelled so nobody
  // reads this as evidence they occur: a CREDIT_LABELS entry is only matched in
  // label position before a colon, so an unused one cannot cause a false
  // positive, while a missing one turns a credit into an annotated, translated
  // lyric — which is the bug 编曲/和声编写 actually was.
  for (const line of ["Lyrics: someone", "Composer: Hu Duoduo", "Vocal：Luo Tianyi"]) {
    assert.equal(isCreditLine(line), true, line);
  }
});

test("multi-word english roles are detected", () => {
  // The label is compared with spaces stripped, so these could never match
  // while the table stored them spaced. Every one of them was dead.
  for (const line of [
    "Composed by: someone",
    "Written by: someone",
    "Arranged by: someone",
    "Produced by: someone",
    "Translated by: someone",
    "Special Thanks: everyone",
  ]) {
    assert.equal(isCreditLine(line), true, line);
  }
});

test("detects compound role labels", () => {
  assert.equal(isCreditLine("作词作曲：某人"), true);
  assert.equal(isCreditLine("词/曲：某人"), true);
  assert.equal(isCreditLine("Lyrics & Music: someone"), true);
});

test("a trailing separator does not make a single role a compound", () => {
  // "Lyrics&" normalizes to "lyrics&", which fails the direct lookup but
  // splits to the single valid part ["lyrics"]. Accepting that would let any
  // role plus a stray separator through.
  assert.equal(isCreditLine("Lyrics&: someone"), false);
  assert.equal(isCreditLine("作词、：某人"), false);
});

test("a long compound credit is still a credit", () => {
  // The label length bound is only a prefilter, and at 20 characters it was
  // rejecting ordinary Vocaloid credits.
  assert.equal(isCreditLine("Lyrics & Music & Arrangement: someone"), true);
  assert.equal(isCreditLine("special thanks & translation: someone"), true);
});

test("every part of a compound label has to be a role", () => {
  // 作词/张三 pairs a role with a name, which is a lyric-side slash, not a
  // two-role credit. Accepting it because one part matches would swallow real
  // lines.
  assert.equal(isCreditLine("作词/张三: 甲"), false);
  assert.equal(isCreditLine("Lyrics & 僕: something"), false);
});

test("leaves real lyrics alone", () => {
  // 但我爱的人都会一个一个死去 and 嗚呼 are 無 as the app serves it; an earlier
  // version wrote the first with traditional 愛/個 beside simplified 都会,
  // a hybrid spelling no lyric uses.
  for (const line of [
    "灯篭の灯に照らされてゆく",
    "但我爱的人都会一个一个死去",
    "嗚呼",
    "今宵も天は明るく",
    "水柔而无形 汇入一方庭园",
    "It's fxxking hard to say it, goodbye",
  ]) {
    assert.equal(isCreditLine(line), false, line);
  }
});

test("a lyric containing a colon is not treated as a credit", () => {
  assert.equal(isCreditLine("君に言った: さよなら"), false);
  assert.equal(isCreditLine("答案是：我不知道"), false);
});

test("a label with no value is not a credit", () => {
  assert.equal(isCreditLine("作詞:"), false);
  assert.equal(isCreditLine("作詞"), false);
});

test("credit shape accepts a label the vocabulary cannot, but refuses a lyric", () => {
  // The shape test is the weaker signal a caller combines with position, so it
  // must not swallow lyrics on its own. All three are captured: 谢怜 and 花城
  // are characters credited to their voice actors in 悦神, and 注 heads the
  // closing note on the 国风堂 track. None is a role word and none can ever be
  // one — they are a name, a name, and a punctuation-like marker — so the
  // vocabulary must keep refusing them however far it grows. Position is the
  // only thing that can recognize these, which is the credit run's whole job.
  for (const line of ["谢怜：苏尚卿", "花城：杨天翔", "注：本故事来自国风堂"]) {
    assert.equal(hasCreditShape(line), true, line);
    assert.equal(isCreditLine(line), false, line);
  }
  // These three used to sit in the list above as "unlisted roles". They are
  // real roles, and the morpheme table reaches them now.
  for (const line of ["PV: someone", "Mastering Engineer: someone", "特效：某人"]) {
    assert.equal(isCreditLine(line), true, line);
  }
  // Kana in the label means a sentence, not a role.
  assert.equal(hasCreditShape("君に言った: さよなら"), false);
  // No colon at all, and a label too long to be a role.
  assert.equal(hasCreditShape("僕らの居場所はどこなんだ"), false);
  assert.equal(hasCreditShape("答案是：我不知道"), false);
});

test("a known credit is also credit-shaped", () => {
  for (const line of ["作词: 立入禁止", "编曲: 黒うさP", "Composed by: someone"]) {
    assert.equal(hasCreditShape(line), true, line);
  }
});

test("concatenated roles are recognized without being listed", () => {
  // 和声编写 is 和声 + 编写. Captured from a real song, where it was the one
  // credit the table missed and so got pinyin and a translation.
  assert.equal(isCreditLine("和声编写：雾敛"), true);
  assert.equal(isCreditLine("词曲编：某人"), true);
  assert.equal(isCreditLine("作词作曲编曲：某人"), true);
  // A single role must not decompose into itself.
  assert.equal(isCreditLine("笛子：囚牛"), true);
  // Nonsense that merely contains a role character stays a lyric.
  assert.equal(isCreditLine("春风漫草野：某人"), false);
});

test("a rights notice is recognized without a label or a colon", () => {
  // Standard boilerplate, not a capture: no song held here has ever carried
  // one, and the user reports they turn up. Written from the forms the notices
  // actually take rather than invented, but do not read this as evidence of
  // what NetEase serves — replace it the first time a capture shows one.
  for (const line of [
    "未经许可不得使用",
    "未经著作权人许可，不得翻唱、翻录或使用",
    "版权所有 侵权必究",
    "本歌曲版权由某某音乐娱乐集团享有",
    "未经授权请勿转载",
  ]) {
    assert.equal(isCopyrightNotice(line), true, line);
  }
});

test("one ordinary word is never enough to make a notice", () => {
  // 不得 is the reason the vocabulary is split in two. It is everywhere in
  // literary Chinese lyrics, so on its own it must count for nothing — one
  // false positive here deletes a sung line outright.
  for (const line of [
    "舍不得你走",
    "不得不说再见",
    "我不得已才离开",
    "使用这把剑",
    "白马过了离原，三月的天，春风漫草野",
    "醉卧 万里沙场 太行风霜 少年自天涯",
  ]) {
    assert.equal(isCopyrightNotice(line), false, line);
  }
  // Two of them together is the threshold, and the legal words stand alone.
  assert.equal(isCopyrightNotice("未经许可"), true);
  assert.equal(isCopyrightNotice("版权"), true);
});

test("singer markers are not lyrics", () => {
  for (const line of ["【合】", "【minus】", "【海伊】", "[Chorus]", "（合）"]) {
    assert.equal(isPartMarkerLine(line), true, line);
  }
});

test("a parenthesized lyric is not a singer marker", () => {
  // Bounded length is what separates a name from a whole sung line.
  assert.equal(isPartMarkerLine("（白马过了离原，三月的天，春风漫草野）"), false);
  assert.equal(isPartMarkerLine("【合】白马过了离原"), false);
  assert.equal(isPartMarkerLine("白马过了离原"), false);
});

test("a label longer than the bound is not a credit, however valid its parts", () => {
  // CREDIT_LINE caps the label at 40 characters as a cheap prefilter before the
  // role lookup runs. The bound is the only thing rejecting this: every part is
  // a real role, so the compound check would otherwise accept it. Raising the
  // cap to 400 lets a 47-character label through, which is how a long lyric
  // containing a colon starts being eaten as a credit.
  const long = "作词 & 作曲 & 编曲 & 混音 & 母带 & 后期 & 录音 & 调校 & 曲绘 & 视频";
  assert.equal(long.length, 47);
  assert.equal(isCreditLine(`${long}: A`), false);
  // The same construction inside the bound is still recognized.
  assert.equal(isCreditLine("作词 & 作曲: A"), true);
});
