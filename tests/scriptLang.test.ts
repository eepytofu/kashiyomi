import { strict as assert } from "node:assert";
import { test } from "node:test";
import { labelScript, scriptForFont, targetLangScript } from "../src/engine/scriptLang.ts";

// Lyric fixtures are captured lines from 下等马 (ChiliChill / 洛天依), 2026-08-05.
// Translation fixtures are marked as constructed, because no captured song has
// been translated to a CJK target on this install.

test("kana decides outright, whatever the caller's evidence says", () => {
  // 下等马 line 7: a Mandarin line ending in kana.
  assert.equal(labelScript("如果我下手太重すみません", "zh"), "ja");
  // Constructed: a Japanese translation of a Chinese lyric.
  assert.equal(labelScript("頭を上げて", "zh"), "ja");
});

test("a simplified-only form decides, and outranks the fallback", () => {
  // 头 is simplified-only, so these never reach the caller's evidence.
  assert.equal(labelScript("头抬起来", "ja"), "zh");
  assert.equal(labelScript("在悬崖看红霞", "ja"), "zh");
  // Constructed: a Chinese translation under a Japanese song.
  assert.equal(labelScript("抬起头来", "ja"), "zh");
});

test("a japanese-only glyph decides when there is no chinese evidence", () => {
  assert.equal(labelScript("峠", "zh"), "ja");
});

test("chinese evidence outranks a japanese glyph form", () => {
  // Deliberately artificial — no lyric mixes a simplified-only form with a
  // kokuji. It pins the rung order, which is a real decision and otherwise
  // untested: a simplified-only form is unambiguous, while a Japanese form
  // overlaps kyūjitai, so 头 has to beat 峠. Same precedence as cjk.ts.
  assert.equal(labelScript("头峠", "ja"), "zh");
});

test("text that is only shared forms defers to the caller", () => {
  // 立入禁止 is the canonical case: not just written identically in both
  // scripts, but genuinely read in both. VocaDB lists the producer under
  // Tachiiri Kinshi *and* Lìrù Jìnzhǐ, alongside 立入禁止P and 审核禁止. Nothing
  // in the string can settle it because there is nothing to settle — this is
  // the rung the fallback exists for.
  assert.equal(labelScript("立入禁止", "ja"), "ja");
  assert.equal(labelScript("立入禁止", "zh"), "zh");
  // And with no outside evidence either, it stays untagged rather than guessing.
  assert.equal(labelScript("立入禁止", undefined), undefined);
});

test("text with no han is never tagged", () => {
  // The common case: an English translation row. Latin has no regional
  // variants, so tagging it would only pick a CJK face for Latin text.
  assert.equal(labelScript("Lift up your head", "zh"), undefined);
  assert.equal(labelScript("", "zh"), undefined);
});

test("a lyric-list line falls back rather than going untagged", () => {
  // The markers of 归家, captured 2026-08-06, in the order they appear. Under
  // labelScript the middle one is undefined — no kana, no Han, 【】 being CJK
  // punctuation rather than Han script — so it kept NCM's default stack while
  // its neighbours took the user's Chinese face. Three treatments of one kind
  // of line, in one song.
  assert.equal(scriptForFont("【哦漏】", "zh"), "zh");
  assert.equal(scriptForFont("【KBShinya 】", "zh"), "zh");
  assert.equal(scriptForFont("【KBShinya/哦漏】", "zh"), "zh");
  // Section markers from the same song, which carry no script either.
  assert.equal(scriptForFont("-M-", "zh"), "zh");
  assert.equal(scriptForFont("/题记/", "zh"), "zh");
});

test("the line's own script still outranks the document it sits in", () => {
  // The fallback fills silence; it does not overrule evidence. A Japanese line
  // inside a Chinese song keeps its own face.
  assert.equal(scriptForFont("君に言った", "zh"), "ja");
  assert.equal(scriptForFont("头抬起来", "ja"), "zh");
});

test("with no document branch, nothing is tagged at all", () => {
  // The property that makes a separate 'unknown script' font unnecessary: when
  // the branch is undecided this abstains for *every* line, lyrics included, so
  // the page is uniform on NCM's default rather than mixed. There is no case
  // where some lines resolve and others do not.
  for (const text of ["【KBShinya 】", "-M-", "Lift up your head", ""]) {
    assert.equal(scriptForFont(text, undefined), undefined, text);
  }
  // Except where the text speaks for itself, which is still honoured.
  assert.equal(scriptForFont("君に言った", undefined), "ja");
  assert.equal(scriptForFont("头抬起来", undefined), "zh");
});

test("only the panel's own CJK targets map to a script", () => {
  assert.equal(targetLangScript("简体中文"), "zh");
  assert.equal(targetLangScript("繁體中文"), "zh");
  assert.equal(targetLangScript("日本語"), "ja");
  assert.equal(targetLangScript(" 日本語 "), "ja");
  // Non-CJK entries and free-text Custom values are deliberately undefined:
  // an ambiguous Han-only translation then stays untagged, which is the
  // behaviour that shipped before this ladder existed, so it cannot regress.
  assert.equal(targetLangScript("English"), undefined);
  assert.equal(targetLangScript("한국어"), undefined);
  assert.equal(targetLangScript("casual English"), undefined);
});
