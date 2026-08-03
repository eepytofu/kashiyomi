import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isCreditLine } from "../src/engine/metadata.ts";

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

test("detects compound role labels", () => {
  assert.equal(isCreditLine("作词作曲：某人"), true);
  assert.equal(isCreditLine("词/曲：某人"), true);
  assert.equal(isCreditLine("Lyrics & Music: someone"), true);
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
