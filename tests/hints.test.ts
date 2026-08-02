import { strict as assert } from "node:assert";
import { test } from "node:test";
import { projectReadingHints } from "../src/engine/hints.ts";

test("accepts an inline reading hint and hides the parenthetical", () => {
  const { displayText, hints } = projectReadingHints("天(そら)へ翔けてゆけ");
  assert.equal(displayText, "天へ翔けてゆけ");
  assert.deepEqual(hints, [{ start: 0, end: 1, reading: "そら" }]);
});

test("accepts fullwidth parentheses", () => {
  const { displayText, hints } = projectReadingHints("永久（とわ）に輝く");
  assert.equal(displayText, "永久に輝く");
  assert.deepEqual(hints, [{ start: 0, end: 2, reading: "とわ" }]);
});

test("accepts a line-final hint when real context precedes it", () => {
  const { displayText, hints } = projectReadingHints("消えない灯(あかり)");
  assert.equal(displayText, "消えない灯");
  assert.deepEqual(hints, [{ start: 4, end: 5, reading: "あかり" }]);
});

test("multiple hints in one line", () => {
  const { displayText, hints } = projectReadingHints("天(そら)と地(つち)の間");
  assert.equal(displayText, "天と地の間");
  assert.deepEqual(hints, [
    { start: 0, end: 1, reading: "そら" },
    { start: 2, end: 3, reading: "つち" },
  ]);
});

test("rejects a standalone chant echo", () => {
  const line = "勝負服(はっはっ)";
  const { displayText, hints } = projectReadingHints(line);
  assert.equal(displayText, line);
  assert.deepEqual(hints, []);
});

test("rejects when whitespace precedes the paren", () => {
  const line = "天 (そら)へ";
  const { displayText, hints } = projectReadingHints(line);
  assert.equal(displayText, line);
  assert.deepEqual(hints, []);
});

test("rejects non-kana parentheticals", () => {
  const line = "天(Stage)へ";
  const { displayText, hints } = projectReadingHints(line);
  assert.equal(displayText, line);
  assert.deepEqual(hints, []);
});
