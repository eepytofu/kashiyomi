import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isCreditLine } from "../src/engine/metadata.ts";

test("detects japanese credits", () => {
  for (const line of [
    "作詞: 立入禁止",
    "作曲: 立入禁止",
    "編曲: 立入禁止",
    "唄：歌爱ユキ",
    "ミックス: someone",
    "イラスト：絵師",
  ]) {
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
  for (const line of [
    "灯篭の灯に照らされてゆく",
    "但我愛的人都会一個一個死去",
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
