import { strict as assert } from "node:assert";
import { test } from "node:test";
import { hasCreditShape, isCreditLine, isPartMarkerLine } from "../src/engine/metadata.ts";

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

test("detects english credits", () => {
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

test("credit shape accepts an unlisted role but refuses a lyric", () => {
  // The shape test is the weaker signal a caller combines with position and
  // translation state, so it must not swallow lyrics on its own.
  for (const line of ["PV: someone", "Mastering Engineer: someone", "特效：某人"]) {
    assert.equal(hasCreditShape(line), true, line);
    assert.equal(isCreditLine(line), false, line);
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
