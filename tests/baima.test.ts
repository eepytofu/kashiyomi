import { strict as assert } from "node:assert";
import { test } from "node:test";
import { classifyLines } from "../src/engine/lineKinds.ts";

/**
 * 白马过了离原 (冉语优 / 海伊 / 星尘Minus), captured from the running app on
 * 2026-08-04 with `npm run capture`, read from data-kashiyomi-src so this is
 * NetEase's own text and not our repaired output. 译 was off, which is the
 * default, so every line is untranslated and the credit-shape fallback is
 * inert: classification here rests entirely on the role table and the marker
 * pattern.
 *
 * This is the only fixture in the suite that runs a whole real song end to
 * end. It is the regression test for the credit block a duet upload actually
 * ships, including 和声编写 (和声 + 编写, decomposed rather than listed) and
 * 笛子, which must not decompose into itself.
 */
const BAIMA = [
  "作词: 冉语优",
  "作曲: 塔库",
  "编曲: Fsy小诺",
  "作曲：塔库",
  "作词：冉语优",
  "编曲：Fsy小诺",
  "演唱：海伊、星尘Minus",
  "调教：瑞安Ryan",
  "笛子：囚牛",
  "和声编写：雾敛",
  "混音：Mr.曾经",
  "【合】",
  "白马过了离原，三月的天，春风漫草野",
  "谁隔着那么远，仰头看纸鸢",
  "千里外不曾相见，明朗眉眼，是谁正负剑",
  "鞍马前夕阳斜，遥遥牵着线",
  "【minus】",
  "杏花开落挑拣好时节，纷纷正垂檐",
  "张伞一抬眼，细雨落额前",
  "庭中树，初长成还不及肩",
  "摘新叶，归来做诗签",
  "年华尚浅的人，心事都浅",
  "【海伊】",
  "不爱信痴梦却又偏偏，深信世间盛名的传言",
  "并非谁杜撰或戏写的风月",
  "天高远，谈笑间指银鞭，扬扬三千",
  "其中哪一个，向我回眸一眼",
  "【minus】",
  "合卷后闲梦屏边，雨细风斜，飞去枝上鹊",
  "兵戈声依稀吹远，倒卷入重帘",
  "三鼓前城旗掩近昏的夜",
  "谁衣衫却白得那样惹眼",
  "像露晞前明明欲曙的天",
  "【海伊】",
  "杏花开落挑拣好时节，纷纷正垂檐",
  "张伞一抬眼，细雨落额前",
  "庭中树，都还不及你我肩",
  "偷垂眼，莞然相照面",
  "眉妆浅浅的人，心事不浅",
  "【minus】",
  "撑腮看天上一弯新月，不胜谁的远山眉纤纤",
  "想着今朝该写的诗还未写",
  "听不见，究竟哪扇窗前，风雨周旋",
  "把小炉金嵌，拥暖在指掌间",
  "【海伊】",
  "识得小字几万千，夜天压雪，案前灯明灭",
  "应当能陪谁消解，兵书四五卷",
  "是你么，按图指点三千言",
  "是你么，青衫走马上天街",
  "在梦中故事里可曾相见",
  "【minus】",
  "日高处群鹰流连，云舒云卷，天地初开篇",
  "江山分合又离间，终究归少年",
  "【合】",
  "小楼看平川外尽是郊野",
  "浮云来遮明月惊了乌鹊",
  "却向何处找寻我的人间",
  "【海伊】",
  "不知不觉，何处找寻我的人间",
] as const;

test("the whole song splits into 11 credits, 10 markers and 38 lyrics", () => {
  const kinds = classifyLines(
    BAIMA.map((text) => ({ text, translation: "untranslated" as const })),
  );
  assert.equal(BAIMA.length, 59);
  assert.equal(kinds.filter((k) => k === "credit").length, 11);
  assert.equal(kinds.filter((k) => k === "marker").length, 10);
  assert.equal(kinds.filter((k) => k === "lyric").length, 38);
});

test("the credits are exactly the first eleven lines", () => {
  const kinds = classifyLines(
    BAIMA.map((text) => ({ text, translation: "untranslated" as const })),
  );
  const creditIndices = kinds
    .map((k, i) => (k === "credit" ? i : -1))
    .filter((i) => i >= 0);
  assert.deepEqual(creditIndices, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test("no sung line is mistaken for a credit", () => {
  // Every lyric in this song is comma-heavy Chinese and several are long
  // enough to look like a label if the bound slipped.
  const kinds = classifyLines(
    BAIMA.map((text) => ({ text, translation: "untranslated" as const })),
  );
  for (let i = 11; i < BAIMA.length; i++) {
    assert.notEqual(kinds[i], "credit", `line ${i}: ${BAIMA[i]}`);
  }
});
