import { strict as assert } from "node:assert";
import { test } from "node:test";
import { kanaToRomaji, tokenRomaji } from "../src/engine/romaji.ts";

test("basic syllables", () => {
  assert.equal(kanaToRomaji("そら"), "sora");
  assert.equal(kanaToRomaji("あかり"), "akari");
  assert.equal(kanaToRomaji("サクラ"), "sakura");
});

test("wapuro long vowels stay spelled out", () => {
  assert.equal(kanaToRomaji("とうきょう"), "toukyou");
  assert.equal(kanaToRomaji("ゆうき"), "yuuki");
});

test("prolonged sound mark repeats the vowel", () => {
  assert.equal(kanaToRomaji("ラーメン"), "raamen");
  assert.equal(kanaToRomaji("スーパー"), "suupaa");
});

test("sokuon doubles the consonant, tch before ch", () => {
  assert.equal(kanaToRomaji("きって"), "kitte");
  assert.equal(kanaToRomaji("まっちゃ"), "matcha");
  assert.equal(kanaToRomaji("あっ"), "at");
});

test("n and n'", () => {
  assert.equal(kanaToRomaji("しんや"), "shin'ya");
  assert.equal(kanaToRomaji("てんいん"), "ten'in");
  assert.equal(kanaToRomaji("さんぽ"), "sanpo");
  assert.equal(kanaToRomaji("ほん"), "hon");
});

test("digraphs", () => {
  assert.equal(kanaToRomaji("しゃしん"), "shashin");
  assert.equal(kanaToRomaji("じゅう"), "juu");
  assert.equal(kanaToRomaji("ちょう"), "chou");
});

test("non-kana passes through", () => {
  assert.equal(kanaToRomaji("Fake の gold"), "Fake no gold");
});

test("particle spellings", () => {
  assert.equal(tokenRomaji("は", "ハ", "particle"), "wa");
  assert.equal(tokenRomaji("へ", "ヘ", "particle"), "e");
  assert.equal(tokenRomaji("を", "ヲ", "particle"), "wo");
  assert.equal(tokenRomaji("は", "ハ", "noun"), "ha");
});

test("reading takes precedence over surface", () => {
  assert.equal(tokenRomaji("灯篭", "トウロウ", "noun"), "tourou");
  assert.equal(tokenRomaji("そら", "", "noun"), "sora");
});
