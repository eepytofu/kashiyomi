import { strict as assert } from "node:assert";
import { test } from "node:test";
import { classifyLines, CREDIT_SCAN_LINES, type ClassifiableLine } from "../src/engine/lineKinds.ts";

/** Shorthand for a song NCM is showing no 译 rows for. */
function untranslated(...texts: string[]): ClassifiableLine[] {
  return texts.map((text) => ({ text, translation: "untranslated" as const }));
}

test("a credit header is separated from the lyrics under it", () => {
  // 白马过了离原, captured 2026-08-03: the opening credits, the singer marker
  // that follows them, and the first sung line.
  const kinds = classifyLines(
    untranslated("作词：某人", "和声编写：雾敛", "笛子：囚牛", "【合】", "白马过了离原"),
  );
  assert.deepEqual(kinds, ["credit", "credit", "credit", "marker", "lyric"]);
});

test("a marker outranks the credit tests", () => {
  // Markers are skipped whatever the credits setting says, so they must never
  // come back as "credit" — the caller annotates credits on request but never
  // annotates markers.
  assert.deepEqual(classifyLines(untranslated("【合】", "[Chorus]", "（合）")), [
    "marker",
    "marker",
    "marker",
  ]);
});

test("a parenthesized lyric line stays a lyric", () => {
  // 白马过了离原 writes a whole sung line in brackets. Length is what separates
  // it from a singer's name.
  assert.deepEqual(classifyLines(untranslated("（白马过了离原，三月的天，春风漫草野）")), [
    "lyric",
  ]);
});

test("the shape fallback needs all three signals", () => {
  // PV: is a real credit the role table does not list. On its own the shape is
  // not enough — it is only a credit when the song is being translated and
  // this line was passed over.
  const song: ClassifiableLine[] = [
    { text: "PV：某人", translation: "untranslated" },
    { text: "白马过了离原", translation: "translated" },
  ];
  assert.deepEqual(classifyLines(song), ["credit", "lyric"]);
});

test("the shape fallback is inert when the song carries no translations", () => {
  // With 译 off every line reads as untranslated, so "untranslated" carries no
  // information and the fallback has to switch itself off. Otherwise any
  // colon-bearing opening line would be dropped from a song nobody translated.
  assert.deepEqual(classifyLines(untranslated("PV：某人", "白马过了离原")), ["lyric", "lyric"]);
});

test("the shape fallback reaches six lines in and no further", () => {
  // Synthetic: a colon-bearing line walked down the song one position at a
  // time. Deep in a lyric a colon is just a colon, so the bound is what stops
  // a real line being dropped.
  //
  // The expected positions are written as literals on purpose. Deriving them
  // from CREDIT_SCAN_LINES makes the test move with the constant, so widening
  // the bound to any value would still pass — checked with the mutation
  // `lineKinds/scan-bound-unbounded`, which survived until this was literal.
  assert.equal(CREDIT_SCAN_LINES, 6);
  for (let position = 0; position < 8; position++) {
    const lines: ClassifiableLine[] = [];
    for (let i = 0; i < 8; i++) {
      lines.push(
        i === position
          ? { text: "PV：某人", translation: "untranslated" }
          : { text: "白马过了离原", translation: "translated" },
      );
    }
    assert.equal(
      classifyLines(lines)[position],
      position <= 5 ? "credit" : "lyric",
      `position ${position}`,
    );
  }
});

test("a listed role is a credit wherever it sits and however 译 is set", () => {
  // The table path is independent of position and translation state: it is the
  // only path that works with 译 off, which is the default.
  const lines: ClassifiableLine[] = [];
  for (let i = 0; i < CREDIT_SCAN_LINES + 3; i++) {
    lines.push({ text: "白马过了离原", translation: "untranslated" });
  }
  lines.push({ text: "笛子：囚牛", translation: "untranslated" });
  const kinds = classifyLines(lines);
  assert.equal(kinds[kinds.length - 1], "credit");
});

test("a translated opening line is a lyric even when it is credit-shaped", () => {
  // The player translating it is what says it is not a credit — NetEase never
  // translates the credit block.
  const song: ClassifiableLine[] = [
    { text: "PV：某人", translation: "translated" },
    { text: "白马过了离原", translation: "translated" },
  ];
  assert.deepEqual(classifyLines(song), ["lyric", "lyric"]);
});

test("a credit block at the foot of the song is found too", () => {
  // Captured 2026-08-06 with `npm run capture` from a 65-line 国风堂 track
  // (哦漏 / KBShinya), 译 off. Four credits at the head, eleven at the foot, and
  // the foot is where the role table failed hardest — 分轨, 企划题字, 插画, 设计
  // and the 注： note were all annotated and queued for translation, because
  // every position rule we had only ever looked at the top of the file.
  //
  // Trimmed to the two blocks and the lines that bound them: the sung middle
  // adds no signal this test does not already have. 吉他 is kept because it is
  // the anchor nearest the misses, and because it reaches the run through the
  // role table rather than through shape — `hasCreditShape` vetoes it, 他 being
  // in SENTENCE_CHARS.
  const kinds = classifyLines(
    untranslated(
      "作词: 释子 / 公子无琊",
      "文案故事：康玉婷（网易云音乐用户@糖果超级咸）",
      "/题记/",
      "那时节 芳草萋萋寒鸦日暮",
      "惟愿戴荣光与你归家",
      "分轨：向往",
      "吉他：大牛",
      "企划题字：毫克",
      "插画：RedMatcha",
      "设计：马睿",
      "出品：网易云音乐·国风堂",
    ),
  );
  assert.deepEqual(kinds, [
    "credit",
    // Unlisted, reached by growing forward from 作词.
    "credit",
    // The head block stops here: /题记/ carries no colon at all.
    "lyric",
    "lyric",
    "lyric",
    // The foot block, grown backward from 吉他 and 出品.
    "credit",
    "credit",
    "credit",
    "credit",
    "credit",
    "credit",
  ]);
});

test("an unlisted role inside the opening block is a credit with 译 off", () => {
  // 太成都 (马思唯), read off a screenshot 2026-08-05: 女声 and 录音室 got pinyin
  // and a translation while the credits around them were skipped. Neither is in
  // the role table, and the shape fallback above cannot reach them — NetEase
  // never translates a Chinese song into Chinese, so `songHasTranslations` is
  // false for the entire class of song this happens on.
  const kinds = classifyLines(
    untranslated(
      "编曲: YYKBZ / Yoken_Official / Myles William",
      "女声: Laurie",
      "混音: 高宇豪",
      "母带: Colin Leonard at SING Mastering",
      "录音室: Dark Horse Studio",
      "带你去看成都的街",
    ),
  );
  assert.deepEqual(kinds, ["credit", "credit", "credit", "credit", "credit", "lyric"]);
});

test("a run ends at the first line that is not credit-shaped", () => {
  // 悦神 (KBShinya), read off a screenshot 2026-08-06. 原著 and the two character
  // names are unlisted roles; the bracketed line reads as a singer marker, which
  // is skipped the same way. The run has to stop dead at 天官赐福 — that is the
  // first sung line, and it is the only thing standing between this rule and
  // eating a song whole.
  const kinds = classifyLines(
    untranslated(
      "作词：狐周周",
      "笛子：囚牛 二胡：辰小弦 混音：Mr.曾经",
      "原著：墨香铜臭",
      "谢怜：苏尚卿 花城：杨天翔",
      "【配音鸣谢：729声工场】",
      "天官赐福 百无禁忌",
      "混音：某人",
    ),
  );
  assert.deepEqual(kinds, [
    "credit",
    "credit",
    "credit",
    "credit",
    "marker",
    "lyric",
    // Past the run, the role table still stands on its own.
    "credit",
  ]);
});

test("the run does not reach a credit-shaped line past the first lyric", () => {
  // The break is only observable here. A line that is not credit-shaped stays a
  // lyric whatever the run says, so ending the run on it changes nothing; what
  // the break protects is the *next* shaped line. Without it the run covers the
  // whole song and PV：某人 at the bottom is silently dropped.
  // Caught by `lineKinds/run-never-breaks`, which survived until this case
  // existed.
  assert.deepEqual(classifyLines(untranslated("作词：某人", "白马过了离原", "PV：某人")), [
    "credit",
    "lyric",
    "lyric",
  ]);
});

test("shape alone cannot open a credit block", () => {
  // Without an anchor a song whose first lines merely carry colons would lose
  // them. 答案是：我不知道 is not credit-shaped, but PV：某人 is, and one
  // credit-shaped opener must not be enough to start a run.
  assert.deepEqual(classifyLines(untranslated("PV：某人", "特效：某人", "白马过了离原")), [
    "lyric",
    "lyric",
    "lyric",
  ]);
});

test("indices line up with the input", () => {
  const song = untranslated("作词：某人", "白马过了离原", "【海伊】", "三月的天");
  const kinds = classifyLines(song);
  assert.equal(kinds.length, song.length);
  assert.deepEqual(kinds, ["credit", "lyric", "marker", "lyric"]);
});

test("an empty song classifies to nothing", () => {
  assert.deepEqual(classifyLines([]), []);
});
