import { strict as assert } from "node:assert";
import { test } from "node:test";
import { repairJapaneseHan } from "../src/engine/hanRepair.ts";

test("repairs simplified glyphs in japanese lyrics", () => {
  assert.equal(repairJapaneseHan("梦见ては"), "夢見ては");
  assert.equal(repairJapaneseHan("无常の风"), "無常の風");
});

test("a kyujitai lyric is preserved, not modernized", () => {
  // This test used to assert the opposite — 櫻の木の下で → 桜の木の下で — which
  // was out of scope: repair is for simplified transport damage, and 櫻 in a
  // lyric is the lyricist's spelling.
  assert.equal(repairJapaneseHan("櫻の木の下で"), "櫻の木の下で");
  assert.equal(repairJapaneseHan("戀をした"), "戀をした");
});

test("correct japanese is untouched", () => {
  const line = "灯篭の灯に照らされてゆく";
  assert.equal(repairJapaneseHan(line), line);
  const line2 = "芸術と缶と経験";
  assert.equal(repairJapaneseHan(line2), line2);
});

test("kanau keeps 叶", () => {
  assert.equal(repairJapaneseHan("愿いが叶う"), "願いが叶う");
  assert.equal(repairJapaneseHan("叶えて"), "叶えて");
});

test("a genuine 葉 survives a line that is being repaired", () => {
  // The 叶 restore only runs on lines OpenCC actually changed, so it needs a
  // fixture carrying both a converted glyph and a real 葉. Restoring without
  // checking the okurigana would turn 葉っぱ into 叶っぱ.
  assert.equal(repairJapaneseHan("梦见葉っぱ"), "夢見葉っぱ");
  assert.equal(repairJapaneseHan("头发の葉が"), "頭髪の葉が");
});

test("kougou stays 皇后", () => {
  assert.equal(repairJapaneseHan("皇后と太后"), "皇后と太后");
});

test("a conversion that changes utf-16 length is refused", () => {
  // Found by sweeping every CJK ideograph through the converter: 暅 maps to
  // 𣈶, which is non-BMP and therefore two UTF-16 units. Offsets are the
  // engine's contract, so a line whose length would move is left alone rather
  // than silently shifting every furigana span after it.
  assert.equal(repairJapaneseHan("暅"), "暅");
  assert.equal(repairJapaneseHan("梦见暅"), "梦见暅");
});

test("empty line", () => {
  assert.equal(repairJapaneseHan(""), "");
});

test("kyujitai is left alone; only simplified forms are repaired", () => {
  // Repair exists for one artifact: a Japanese lyric transcribed in simplified
  // by a mainland service. Kyūjitai is not damage — a lyricist who writes 櫻 or
  // 戀 means it, and rewriting it edits the song. OpenCC's cn→jp runs through a
  // traditional pivot and would rewrite 407 such characters on its own.
  for (const kyujitai of ["繼續", "櫻", "戀", "佛", "來", "傳", "亞"]) {
    assert.equal(repairJapaneseHan(kyujitai), kyujitai, kyujitai);
  }
  // The simplified half still works.
  assert.equal(repairJapaneseHan("梦见ては"), "夢見ては");
  assert.equal(repairJapaneseHan("无常"), "無常");
});

test("a line mixing simplified and kyujitai repairs only the simplified half", () => {
  // 梦 is simplified (traditional 夢) so it is repaired; 櫻 is already the old
  // Japanese form and is not a simplified character at all, so it stays.
  assert.equal(repairJapaneseHan("梦と櫻"), "夢と櫻");
});
