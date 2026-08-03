import { strict as assert } from "node:assert";
import { test } from "node:test";
import { repairJapaneseHan } from "../src/engine/hanRepair.ts";

test("repairs simplified glyphs in japanese lyrics", () => {
  assert.equal(repairJapaneseHan("梦见ては"), "夢見ては");
  assert.equal(repairJapaneseHan("无常の风"), "無常の風");
});

test("repairs traditional glyphs to shinjitai", () => {
  assert.equal(repairJapaneseHan("櫻の木の下で"), "桜の木の下で");
  assert.equal(repairJapaneseHan("戀をした"), "恋をした");
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
