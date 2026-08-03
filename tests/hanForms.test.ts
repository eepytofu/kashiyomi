import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  hasChineseOnlyGlyphs,
  hasJapaneseOnlyGlyphs,
  toJapaneseGlyphs,
} from "../src/engine/hanForms.ts";

// These helpers had no direct tests; they were only ever exercised through
// routing, which is how three characters Chinese also uses sat in the
// Japanese-only set without anything noticing.

test("shinjitai forms are japanese-only", () => {
  // Chinese writes these differently in both scripts: 戦/战/戰, 桜/樱/櫻.
  for (const ch of ["戦", "桜", "芸", "沢", "駅", "検"]) {
    assert.equal(hasJapaneseOnlyGlyphs(ch), true, ch);
  }
});

test("kokuji are japanese-only", () => {
  // Invented in Japan, so Chinese has no form for them at all.
  for (const ch of ["峠", "働", "匂", "辻", "凪"]) {
    assert.equal(hasJapaneseOnlyGlyphs(ch), true, ch);
  }
});

test("隣 is japanese-only even though opencc will not convert it back", () => {
  // Chinese writes 邻 (simplified) and 鄰 (traditional), and both convert to
  // 隣. The reverse mapping is missing from OpenCC, so a jp->cn check alone
  // wrongly calls this shared.
  assert.equal(hasJapaneseOnlyGlyphs("隣"), true);
  assert.equal(toJapaneseGlyphs("邻"), "隣");
  assert.equal(toJapaneseGlyphs("鄰"), "隣");
});

test("characters chinese also writes are not japanese evidence", () => {
  // 随 and 壮 are the *simplified* forms of 隨 and 壯, and 糖 is identical in
  // all three scripts. Each of these was in the Japanese-only set, which made
  // any Chinese line containing one look Japanese.
  for (const ch of ["随", "壮", "糖"]) {
    assert.equal(hasJapaneseOnlyGlyphs(ch), false, ch);
  }
  assert.equal(hasJapaneseOnlyGlyphs("随波逐流"), false);
  assert.equal(hasJapaneseOnlyGlyphs("壮丽的风景"), false);
});

test("the iteration mark counts as japanese orthography", () => {
  assert.equal(hasJapaneseOnlyGlyphs("磊々落々"), true);
  assert.equal(hasJapaneseOnlyGlyphs("人々"), true);
});

test("plain shared kanji are not evidence either way", () => {
  for (const ch of ["山", "花", "月", "空"]) {
    assert.equal(hasJapaneseOnlyGlyphs(ch), false, ch);
    assert.equal(hasChineseOnlyGlyphs(ch), false, ch);
  }
});

test("simplified-only forms are chinese evidence", () => {
  // Captured from 無. 无 -> 無 and 离/归 -> 離/帰, so these two carry evidence.
  assert.equal(hasChineseOnlyGlyphs("无可奈何花落去"), true);
  assert.equal(hasChineseOnlyGlyphs("离离虚无无所归"), true);
});

test("a chinese line can carry no glyph evidence at all", () => {
  // 身外尽空虚 is written entirely in characters Japanese uses identically —
  // 尽, 虚 and 空 are not simplifications. This is exactly why routing cannot
  // rest on glyph forms alone, and why the document context and the 译 slot
  // exist.
  assert.equal(hasChineseOnlyGlyphs("身外尽空虚"), false);
  assert.equal(hasJapaneseOnlyGlyphs("身外尽空虚"), false);
});

test("correct japanese carries no chinese glyph evidence", () => {
  for (const line of ["磊々落々 反戦国家", "灯篭の灯に照らされてゆく", "少年少女戦国無双"]) {
    assert.equal(hasChineseOnlyGlyphs(line), false, line);
  }
});
