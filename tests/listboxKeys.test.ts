import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isMoveKey, nextIndex, typeAheadIndex } from "../src/engine/listboxKeys.ts";

// The real list, because the non-Latin entries are the interesting half.
const LANGS = ([
  "English",
  "简体中文",
  "繁體中文",
  "Bahasa Indonesia",
  "日本語",
  "한국어",
  "Español",
  "Français",
  "Deutsch",
  "Português",
  "Русский",
  "ไทย",
  "Tiếng Việt",
  "العربية",
] as const).map((label) => ({ label }));

test("only the keys that move anything are movement keys", () => {
  for (const key of ["ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]) {
    assert.equal(isMoveKey(key), true, key);
  }
  for (const key of ["a", "Enter", "Escape", "Tab", " ", "ArrowLeft"]) {
    assert.equal(isMoveKey(key), false, key);
  }
});

// A Windows select clamps. Wrapping would send Arrow Down on the last option
// back to the top, which reads as the list jumping under the cursor.
test("movement clamps at both ends instead of wrapping", () => {
  assert.equal(nextIndex(13, "ArrowDown", 14), 13, "last stays last");
  assert.equal(nextIndex(0, "ArrowUp", 14), 0, "first stays first");
  assert.equal(nextIndex(5, "ArrowDown", 14), 6);
  assert.equal(nextIndex(5, "ArrowUp", 14), 4);
  assert.equal(nextIndex(5, "Home", 14), 0);
  assert.equal(nextIndex(5, "End", 14), 13);
});

// Opening with nothing selected must land on the first option, not the second:
// -1 + 1 would be 0 by accident for ArrowDown and wrong for everything else.
test("nothing selected yet moves to the first option", () => {
  assert.equal(nextIndex(-1, "ArrowDown", 14), 0);
  assert.equal(nextIndex(-1, "ArrowUp", 14), 0);
  assert.equal(nextIndex(-1, "PageDown", 14), 8);
  assert.equal(nextIndex(-1, "End", 14), 13);
});

test("paging clamps rather than running off the list", () => {
  assert.equal(nextIndex(0, "PageDown", 14), 8);
  assert.equal(nextIndex(12, "PageDown", 14), 13);
  assert.equal(nextIndex(2, "PageUp", 14), 0);
});

test("an empty list has nowhere to move to", () => {
  assert.equal(nextIndex(0, "ArrowDown", 0), -1);
  assert.equal(typeAheadIndex([], "e", 0), -1);
});

test("typing a letter jumps to the next option starting with it", () => {
  assert.equal(typeAheadIndex(LANGS, "d", -1), 8, "Deutsch");
  assert.equal(typeAheadIndex(LANGS, "b", -1), 3, "Bahasa Indonesia");
  assert.equal(typeAheadIndex(LANGS, "E", -1), 0, "case-insensitive: English");
});

// Pressing the same letter again cycles rather than sticking, which is what the
// native control did: E goes English -> Español -> back to English.
test("repeating a letter cycles through the options starting with it", () => {
  const first = typeAheadIndex(LANGS, "e", -1);
  assert.equal(first, 0, "English");
  const second = typeAheadIndex(LANGS, "e", first);
  assert.equal(second, 6, "Español");
  assert.equal(typeAheadIndex(LANGS, "e", second), 0, "wraps back to English");
});

// Several characters refine the current match instead of advancing, so typing
// "es" does not skip past Español to nothing.
test("a multi-character buffer can match where it already is", () => {
  assert.equal(typeAheadIndex(LANGS, "es", 6), 6, "Español");
  assert.equal(typeAheadIndex(LANGS, "en", 0), 0, "English");
});

// The reason this function exists rather than a naive startsWith loop: more than
// a third of the list cannot match an ASCII prefix, and a miss must be a miss.
test("labels that cannot match an ascii prefix are missed, not guessed at", () => {
  assert.equal(typeAheadIndex(LANGS, "z", -1), -1, "no match at all");
  assert.equal(typeAheadIndex(LANGS, "简", -1), 1, "but their own first character does match");
  assert.equal(typeAheadIndex(LANGS, "日", -1), 4);
  assert.equal(typeAheadIndex(LANGS, "ت", -1), -1, "arabic label starts with a different letter");
});

// A list of endonyms is unreachable from a Latin keyboard without this: the
// only prefix most people can type for 日本語 is "japanese".
test("an ascii alias finds a label nobody can type", () => {
  const withAlias = [
    { label: "English", search: "english" },
    { label: "日本語", search: "japanese" },
    { label: "Deutsch", search: "german" },
  ];
  assert.equal(typeAheadIndex(withAlias, "jap", -1), 1);
  assert.equal(typeAheadIndex(withAlias, "ger", -1), 2, "german finds Deutsch");
  assert.equal(typeAheadIndex(withAlias, "deu", -1), 2, "and so does its own label");
  assert.equal(typeAheadIndex(withAlias, "zzz", -1), -1);
});
