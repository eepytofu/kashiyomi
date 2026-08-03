import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  resolveDocumentBranch,
  resolveDocumentContext,
  resolveLineRoute,
} from "../src/engine/cjk.ts";
import { repairJapaneseHan } from "../src/engine/hanRepair.ts";

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
    "但我爱的人都会一个一个死去",
    "但我的生活还会一遍一遍继续",
    "就求你不要孑然一身地老去",
    "我不想五味杂陈地…",
  ]) {
    assert.equal(resolveLineRoute(line, "japanese"), "chinese", line);
  }
});

test("repaired output must never be routed as if it were the source", () => {
  // Kanji repair rewrites Chinese forms into Japanese ones (繼續 to 継続).
  // If that output were ever read back as a line's source, the line would
  // then look Japanese and stay misrouted. Both forms must route the same.
  const source = "但我的生活還会一遍一遍繼續";
  const repaired = repairJapaneseHan(source);
  assert.notEqual(repaired, source, "fixture should actually be rewritten");
  assert.equal(resolveLineRoute(source, "japanese"), "chinese");
  assert.equal(resolveLineRoute(repaired, "japanese"), "chinese");
});

test("kanji-only japanese lines still follow the japanese document", () => {
  for (const line of ["夢見", "花鳥風月", "君想", "嗚呼", "絶体絶命"]) {
    assert.equal(resolveLineRoute(line, "japanese"), "japanese", line);
  }
});

// 無 (立入禁止/歌爱ユキ/诗岸) alternates Japanese verses with Chinese ones.
// Captured from the running app on 2026-08-03, so this is the text NetEase
// actually serves — simplified, which is what it ships for nearly everything.
// An earlier version of this fixture was written in traditional forms that no
// real lyric used; it passed while testing a spelling the code never sees.
const MU_JAPANESE = [
  "嗚呼",
  "僕らの居場所はどこなんだ",
  "まさか本当に所謂心の中",
  "されどこんな空っぽな僕の体",
  "住める人は何処だ",
  "こんな瞳から写った自分は",
  "虚しく見えるのは僕の所為のか？",
  "彷徨う溶ろけそうな僕らの行方は",
  "探せばほんの少しは残っているんだろうか",
];
const MU_CHINESE = [
  "但我爱的人都会一个一个死去",
  "但我的生活还会一遍一遍继续",
  "就求你不要孑然一身地老去",
  "世间无常所谓轮回",
  "离离虚无无所归",
  "无可奈何花落去",
  "身外尽空虚",
  "我知道啊那些你爱我爱你的话",
  "到最后都没有什么归处啊",
  "就算我再怎么拼命挣扎",
  "一百年过后什么也留不下",
];

test("a bilingual song separates its chinese verses from its japanese ones", () => {
  // Its classical lines (无可奈何花落去, 身外尽空虚) carry no Chinese function
  // words, so only the document context separates them from Japanese kanbun.
  // Verified against the running app with 译 off: 16 chinese, 13 japanese.
  const doc = resolveDocumentContext([...MU_JAPANESE, ...MU_CHINESE]);
  assert.equal(doc.bilingual, true);
  for (const line of MU_CHINESE) assert.equal(resolveLineRoute(line, doc), "chinese", line);
  for (const line of MU_JAPANESE) assert.equal(resolveLineRoute(line, doc), "japanese", line);
});

test("repeated verses do not disturb a bilingual song", () => {
  // 無 repeats both its Japanese and Chinese verses. Evidence is counted over
  // distinct lines, so the repeats must change nothing.
  const doc = resolveDocumentContext([
    ...MU_JAPANESE, ...MU_CHINESE, ...MU_JAPANESE, ...MU_CHINESE,
  ]);
  assert.equal(doc.bilingual, true);
  for (const line of MU_CHINESE) assert.equal(resolveLineRoute(line, doc), "chinese", line);
});

test("traditional spelling of the same verses still routes chinese", () => {
  // Rarer than simplified and harder: traditional overlaps heavily with
  // Japanese kyuujitai, so of these only 離離虛無無所歸 (虛) carries
  // Chinese-only glyph evidence, against three of four when simplified.
  const chinese = ["世間無常所謂輪迴", "離離虛無無所歸", "無可奈何花落去", "身外尽空虚"];
  const doc = resolveDocumentContext([...MU_JAPANESE, ...chinese]);
  assert.equal(doc.bilingual, true);
  for (const line of chinese) assert.equal(resolveLineRoute(line, doc), "chinese", line);
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

test("a repeated chorus line is one piece of evidence, not two", () => {
  // 千本桜 repeats 三千世界 常世之闇 and 少年少女戦国無双 in the chorus. Counting
  // occurrences rather than distinct lines let a single kana-free line clear
  // the bilingual threshold on its own, after which every kana-free line in
  // this all-Japanese song routed to Chinese.
  const lines = [
    "大胆不敵に ハイカラ革命",
    "磊々落々 反戦国家",
    "日の丸印の二輪車転がし",
    "悪霊退散 ICBM",
    "環状線を走り抜けて",
    "少年少女戦国無双",
    "三千世界 常世之闇",
    "君ノ声モ届カナイヨ",
    "嘆ク唄モ聞コエナイヨ",
    "三千世界 常世之闇",
    "少年少女戦国無双",
  ];
  const doc = resolveDocumentContext(lines);
  assert.equal(doc.bilingual, false, "a repeated line is not a second language");
  for (const line of ["三千世界 常世之闇", "少年少女戦国無双", "磊々落々 反戦国家"]) {
    assert.equal(resolveLineRoute(line, doc), "japanese", line);
  }
});

test("length alone is not evidence of a second language", () => {
  // Two distinct kana-free lines with no Chinese vocabulary and no
  // Chinese-only glyphs. Absence of Japanese orthography is not presence of
  // Chinese, so this song is not bilingual.
  const doc = resolveDocumentContext([
    "僕らの居場所はどこなんだ",
    "探せばほんの少しは残っているんだろうか",
    "三千世界 常世之闇",
    "天上天下唯我独尊",
  ]);
  assert.equal(doc.bilingual, false);
  assert.equal(resolveLineRoute("三千世界 常世之闇", doc), "japanese");
  assert.equal(resolveLineRoute("天上天下唯我独尊", doc), "japanese");
});

test("japanese orthography outranks the bilingual length rule", () => {
  const bilingual = { branch: "japanese", bilingual: true, hasTranslations: false } as const;
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

test("a translated line is not chinese, an untranslated one in the same song is", () => {
  // NetEase translates foreign lyrics into Chinese and never translates
  // Chinese, so within one song the presence of a translation separates the
  // two languages more reliably than any character heuristic.
  const doc = resolveDocumentContext(
    ["三千世界 常世之闇", "磊々落々 反戦国家", "大胆不敵にハイカラ革命"],
    ["translated", "translated", "translated"],
  );
  assert.equal(doc.hasTranslations, true);
  assert.equal(resolveLineRoute("三千世界 常世之闇", doc, "translated"), "japanese");

  const mixed = resolveDocumentContext(
    ["僕らの居場所はどこなんだ", "世間無常所謂輪迴"],
    ["translated", "untranslated"],
  );
  assert.equal(resolveLineRoute("世間無常所謂輪迴", mixed, "untranslated"), "chinese");
});

test("translation evidence is ignored when the song has none", () => {
  const doc = resolveDocumentContext(["三千世界 常世之闇", "大胆不敵にハイカラ革命"], []);
  assert.equal(doc.hasTranslations, false);
  assert.equal(resolveLineRoute("三千世界 常世之闇", doc, "untranslated"), "japanese");
});
