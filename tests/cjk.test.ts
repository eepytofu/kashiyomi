import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  resolveDocumentBranch,
  resolveDocumentContext,
  resolveLineRoute,
} from "../src/engine/cjk.ts";

test("kana lines mark a document as japanese", () => {
  const branch = resolveDocumentBranch([
    "さくら さくら哀しき 唄よ",
    "灯篭の灯に照らされてゆく",
  ]);
  assert.equal(branch, "japanese");
});

test("han-only majority marks a document as chinese", () => {
  const branch = resolveDocumentBranch([
    "樱花呀 樱花呀 哀怜感伤之歌呀",
    "正被灯笼烛光给照耀着呢",
    "就为了在幸福的日子中逐渐消散的",
  ]);
  assert.equal(branch, "chinese");
});

test("a small japanese island does not flip a chinese document", () => {
  const branch = resolveDocumentBranch([
    "我在每夜彻夜狂想",
    "说不出的抱歉",
    "冰冷霜雪的溶消而歌唱吧",
    "曲折的历史长河",
    "ように",
  ]);
  assert.equal(branch, "chinese");
});

test("kana in a line forces the japanese route", () => {
  assert.equal(resolveLineRoute("だんだん剥がれてく Fake のゴールド", "chinese"), "japanese");
});

test("han-only lines follow the document branch", () => {
  assert.equal(resolveLineRoute("灯篭", "japanese"), "japanese");
  assert.equal(resolveLineRoute("正被灯笼烛光给照耀着呢", "chinese"), "chinese");
});

test("halfwidth katakana is recognized as japanese", () => {
  assert.equal(resolveLineRoute("ｱﾏﾂｷﾂﾈは空を駆ける", "chinese"), "japanese");
  assert.equal(resolveLineRoute("ﾆｼｷﾉｿﾃﾞ", "chinese"), "japanese");
});

test("latin-only lines route nowhere", () => {
  assert.equal(resolveLineRoute("It's hard to say goodbye", "japanese"), undefined);
});

test("chinese lines inside a japanese song are not read as japanese", () => {
  // 無 mixes Japanese verses with Chinese ones; the Chinese lines are
  // Han-only, so without a per-line signal they inherit the document branch.
  for (const line of [
    "但我愛的人都会一個一個死去",
    "但我的生活還会一遍一遍継続",
    "就求你不要孑然一身地老去",
    "我不想五味雜陳地",
  ]) {
    assert.equal(resolveLineRoute(line, "japanese"), "chinese", line);
  }
});

test("kanji-only japanese lines still follow the japanese document", () => {
  for (const line of ["夢見", "花鳥風月", "君想", "嗚呼", "絶体絶命"]) {
    assert.equal(resolveLineRoute(line, "japanese"), "japanese", line);
  }
});

test("classical chinese lines in a bilingual song are not read as japanese", () => {
  // 無 alternates Japanese verses with literary Chinese ones. These carry no
  // Chinese function words at all, so only the document context separates
  // them from Japanese kanbun.
  const doc = resolveDocumentContext([
    "僕らの居場所はどこなんだ",
    "まさか本当に所謂心の中",
    "探せばほんの少しは残っているんだろうか",
    "嗚呼",
    "世間無常所謂輪迴",
    "離離虛無無所帰",
    "無可奈何花落去",
    "身外尽空虚",
  ]);
  assert.equal(doc.bilingual, true);
  for (const line of ["世間無常所謂輪迴", "離離虛無無所帰", "無可奈何花落去", "身外尽空虚"]) {
    assert.equal(resolveLineRoute(line, doc), "chinese", line);
  }
  assert.equal(resolveLineRoute("嗚呼", doc), "japanese");
});

test("a japanese song built on four-character compounds stays japanese", () => {
  // 千本桜 is full of kana-free 熟語 lines. Japanese-only character forms
  // (戦 not 战/戰, 浄 not 净/淨) and the iteration mark 々 identify them.
  const doc = resolveDocumentContext([
    "大胆不敵にハイカラ革命",
    "磊々落々 反戦国家",
    "日の丸印の二輪車転がし",
    "悪霊退散 ICBM",
    "六根清浄 大革命",
    "環状線を走り抜けて",
    "三千世界 常世之闇",
  ]);
  assert.equal(doc.bilingual, false, "japanese compounds are not a second language");
  for (const line of ["磊々落々 反戦国家", "六根清浄 大革命", "三千世界 常世之闇"]) {
    assert.equal(resolveLineRoute(line, doc), "japanese", line);
  }
});

test("japanese orthography outranks the bilingual length rule", () => {
  const bilingual = { branch: "japanese", bilingual: true } as const;
  assert.equal(resolveLineRoute("磊々落々反戦国家", bilingual), "japanese");
  assert.equal(resolveLineRoute("六根清浄大革命", bilingual), "japanese");
});

test("a set phrase in an all-japanese song stays japanese", () => {
  const doc = resolveDocumentContext([
    "僕らの居場所はどこなんだ",
    "まさか本当に所謂心の中",
    "探せばほんの少しは残っているんだろうか",
    "天上天下唯我独尊",
  ]);
  assert.equal(doc.bilingual, false, "one set phrase is not a second language");
  assert.equal(resolveLineRoute("天上天下唯我独尊", doc), "japanese");
});
