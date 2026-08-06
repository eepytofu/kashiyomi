import { strict as assert } from "node:assert";
import { test } from "node:test";
import { prepareJapaneseLine } from "../src/engine/lineText.ts";

const ON = { hanRepair: true, readingHints: true };
const HINTS_OFF = { hanRepair: true, readingHints: false };
const REPAIR_OFF = { hanRepair: false, readingHints: true };

test("display and analysis text are always the same length", () => {
  // The invariant the whole module exists to protect: every offset the
  // analyzer returns indexes the displayed text, so any transform here has to
  // map one character to one. All four lines are captured lyrics.
  for (const source of [
    "今宵も天（そら）は　明るく",
    "夜ニ紛レ",
    "千本桜 夜ニ紛レ",
    "語るも無駄な　自分の言葉",
    "磊々落々 反戦国家",
  ]) {
    for (const options of [ON, HINTS_OFF, REPAIR_OFF]) {
      const out = prepareJapaneseLine(source, options);
      assert.equal(
        out.analysisText.length,
        out.displayText.length,
        `${source} ${JSON.stringify(options)}`,
      );
    }
  }
});

test("an authored reading leaves the display and becomes a hint", () => {
  // アマツキツネ writes 今宵も天（そら）は　明るく. With hints on the parenthetical
  // is consumed: そら is the reading for 天 and no longer sits in the line.
  const out = prepareJapaneseLine("今宵も天（そら）は　明るく", ON);
  assert.equal(out.displayText, "今宵も天は　明るく");
  assert.equal(out.hints.length, 1);
  assert.equal(out.hints[0]?.reading, "そら");
});

test("hints off leaves the line exactly as NetEase serves it", () => {
  // The setting chooses whose reading is used, never whether the markup
  // renders. ad79a2b had this right and a later change broke it; the display
  // must keep its brackets.
  const out = prepareJapaneseLine("今宵も天（そら）は　明るく", HINTS_OFF);
  assert.equal(out.displayText, "今宵も天（そら）は　明るく");
  assert.deepEqual(out.hints, []);
});

test("hints off still keeps the brackets away from the analyzer", () => {
  // SudachiDict contains 天（そら） as one entry reading テン, so an untouched
  // line produced a single five-character token and smeared てん across all of
  // it. The brackets are blanked, not removed, so the length still matches.
  const out = prepareJapaneseLine("今宵も天（そら）は　明るく", HINTS_OFF);
  assert.equal(out.analysisText.includes("（"), false);
  assert.equal(out.analysisText.includes("）"), false);
  assert.equal(out.analysisText.length, out.displayText.length);
  // Only the two bracket characters change; そら itself is still there.
  assert.equal(out.analysisText, "今宵も天 そら は　明るく");
});

test("katakana okurigana is analyzed as hiragana, one character to one", () => {
  // 夜ニ紛レ: Sudachi returns 紛 OOV as written. Converting the line to
  // hiragana for analysis parses it, and the display keeps the stylized form.
  const out = prepareJapaneseLine("夜ニ紛レ", ON);
  assert.equal(out.displayText, "夜ニ紛レ");
  assert.equal(out.analysisText, "夜に紛れ");
});

test("ordinary katakana vocabulary is not converted", () => {
  // 大胆不敵に ハイカラ革命 (千本桜) has hiragana, so it is not an okurigana
  // line and ハイカラ must survive intact.
  const out = prepareJapaneseLine("大胆不敵に ハイカラ革命", ON);
  assert.equal(out.analysisText, "大胆不敵に ハイカラ革命");
});

test("kanji repair rewrites the display, and can be turned off", () => {
  // 梦见ては is the README's own example of a Japanese lyric stored with
  // Chinese glyph forms.
  assert.equal(prepareJapaneseLine("梦见ては", ON).displayText, "夢見ては");
  assert.equal(prepareJapaneseLine("梦见ては", REPAIR_OFF).displayText, "梦见ては");
});

test("repair runs before hints, so a repaired line still yields its reading", () => {
  // Order matters: hint detection is a pattern over the text, so it has to see
  // the repaired form. Synthetic line, built to put the two transforms in the
  // same string.
  const out = prepareJapaneseLine("梦见（ゆめみ）ては", ON);
  assert.equal(out.displayText, "夢見ては");
  assert.equal(out.hints[0]?.reading, "ゆめみ");
});

test("a line with nothing to do comes back untouched", () => {
  const out = prepareJapaneseLine("語るも無駄な　自分の言葉", ON);
  assert.equal(out.displayText, "語るも無駄な　自分の言葉");
  assert.equal(out.analysisText, "語るも無駄な　自分の言葉");
  assert.deepEqual(out.hints, []);
});

test("furigana survives with kanji repair off", () => {
  // The setting chooses what is displayed, not whether the line can be read.
  // It used to gate both, so turning it off handed the analyzer 梦见てる — OOV,
  // no reading, no ruby — for a setting described as being about glyph forms.
  const opts = { hanRepair: false, readingHints: true };
  const prepared = prepareJapaneseLine("梦见てる なにも见てない", opts);
  assert.equal(prepared.displayText, "梦见てる なにも见てない", "display keeps what NetEase served");
  assert.equal(prepared.analysisText, "夢見てる なにも見てない", "analysis sees repaired glyphs");
  assert.equal(prepared.displayText.length, prepared.analysisText.length, "offsets stay aligned");
});

test("kanji repair on changes the display too", () => {
  const prepared = prepareJapaneseLine("梦见てる", { hanRepair: true, readingHints: true });
  assert.equal(prepared.displayText, "夢見てる");
  assert.equal(prepared.analysisText, "夢見てる");
});

test("repair and reading hints stay length-aligned together", () => {
  // Brackets are not Han, so repair never moves them: both projections remove
  // the same span and the two texts stay the same length.
  const prepared = prepareJapaneseLine("梦见（ゆめみ）てる", { hanRepair: false, readingHints: true });
  assert.equal(prepared.displayText.length, prepared.analysisText.length);
  assert.equal(prepared.displayText, "梦见てる");
  assert.equal(prepared.analysisText, "夢見てる");
});
