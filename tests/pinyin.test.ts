import { strict as assert } from "node:assert";
import { test } from "node:test";
import CompleteDict from "@pinyin-pro/data/complete";
import { registerCompleteDict, romanizeMandarin } from "../src/engine/pinyin.ts";

registerCompleteDict(CompleteDict);

test("tone marks by default", () => {
  assert.equal(romanizeMandarin("狂想", { tones: true, joinWords: false }), "kuáng xiǎng");
});

test("complete dictionary picks lexical readings", () => {
  assert.equal(romanizeMandarin("诗行", { tones: true, joinWords: false }), "shī háng");
});

test("word joining keeps segmented words together", () => {
  assert.equal(
    romanizeMandarin("我在每夜狂想", { tones: true, joinWords: true }),
    "wǒ zài měiyè kuángxiǎng",
  );
});

test("a four-syllable word is hyphenated 2+2 for readability", () => {
  // Approximates GB/T 16159 rather than implementing it: the standard hyphenates
  // only idioms that read as two disyllabic feet, and that distinction is not
  // computable here. Kept because four syllables run together is the one length
  // nobody can parse. bùyìlèhū is the known-wrong class; see pinyin.ts.
  const j = (text: string) => romanizeMandarin(text, { tones: true, joinWords: true });
  assert.equal(j("五味杂陈"), "wǔwèi-záchén");
  assert.equal(j("莫名其妙"), "mòmíng-qímiào");
  assert.equal(j("心旷神怡"), "xīnkuàng-shényí");
  // Tone sandhi still applies across the hyphen.
  assert.equal(j("一心一意"), "yìxīn-yíyì");
  // Inside a line, and with the toggle off it is spaced as before.
  assert.equal(j("才心旷神怡"), "cái xīnkuàng-shényí");
  assert.equal(
    romanizeMandarin("才心旷神怡", { tones: true, joinWords: false }),
    "cái xīn kuàng shén yí",
  );
});

test("only four syllables are hyphenated, and only Han ones", () => {
  const j = (text: string) => romanizeMandarin(text, { tones: true, joinWords: true });
  // Two and three syllable words are readable joined and take no hyphen.
  assert.equal(j("在悬崖看红霞"), "zài xuányá kàn hóngxiá");
  assert.equal(j("说不出的sorry"), "shuōbùchū de sorry");
  // Longer runs stay joined. 无可奈何花落去 is one dictionary entry, so there is
  // no word boundary to cut on; a length cap would be an invented constant.
  assert.equal(j("无可奈何花落去"), "wúkěnàihéhuāluòqù");
  // A four-character Latin run is not a four-syllable Chinese word.
  assert.equal(j("abcd"), "abcd");
});

test("no tones", () => {
  assert.equal(romanizeMandarin("狂想", { tones: false, joinWords: false }), "kuang xiang");
});

test("latin runs pass through", () => {
  assert.equal(
    romanizeMandarin("说不出的sorry", { tones: false, joinWords: false }),
    "shuo bu chu de sorry",
  );
  assert.equal(romanizeMandarin("mp3", { tones: true, joinWords: false }), "mp3");
});

test("empty input", () => {
  assert.equal(romanizeMandarin("  ", { tones: true, joinWords: false }), "");
  // The empty string specifically: pinyin-pro throws on it ("Cannot read
  // properties of undefined (reading 'patterns')") while whitespace comes back
  // as "". The guard in romanizeMandarin is what stops that, so it is
  // load-bearing rather than an optimization, and a fixture of "  " alone
  // could not tell the difference.
  assert.equal(romanizeMandarin("", { tones: true, joinWords: false }), "");
});

test("a pinyin row uses latin punctuation", () => {
  // The whole first sung line of 白马过了离原, captured from the app on
  // 2026-08-04. Romanization is Latin-script orthography, so it takes Latin
  // marks; leaving the fullwidth comma in also left the segmenter's spaces on
  // both sides ("lí yuán ， sān").
  assert.equal(
    romanizeMandarin("白马过了离原，三月的天，春风漫草野", { tones: true, joinWords: false }),
    "bái mǎ guò le lí yuán, sān yuè de tiān, chūn fēng màn cǎo yě",
  );
});

test("一 and 不 are written with their changed tone", () => {
  // Ordinary pinyin orthography marks these two: 一个 is yí gè and 不是 is
  // bú shì in dictionaries and teaching material. Third-tone sandhi is the
  // opposite convention and is never written (你好 stays nǐ hǎo), which is why
  // only these two appear here.
  const p = (text: string) => romanizeMandarin(text, { tones: true, joinWords: false });
  assert.equal(p("一个"), "yí gè");
  assert.equal(p("一天"), "yì tiān");
  assert.equal(p("不是"), "bú shì");
  // 不 before a third tone keeps its own tone.
  assert.equal(p("不好"), "bù hǎo");
});

test("一 keeps its plain tone where the change does not apply", () => {
  // Ordinals, dates, digit sequences and final position. Getting these wrong is
  // the risk that comes with enabling the change at all, so they are pinned.
  const p = (text: string) => romanizeMandarin(text, { tones: true, joinWords: false });
  assert.equal(p("第一"), "dì yī");
  assert.equal(p("一月"), "yī yuè");
  assert.equal(p("统一"), "tǒng yī");
  assert.equal(p("万一"), "wàn yī");
  // Both rules inside one idiom.
  assert.equal(p("一心一意"), "yì xīn yí yì");
});

test("a lone 应 before a predicate is the modal yīng", () => {
  const p = (text: string) => romanizeMandarin(text, { tones: true, joinWords: false });
  // The dictionary stocks this pattern 232 times (应有, 应得, 应尽, 应许 …) but
  // not in the literary register lyrics use, so segmentation leaves 应 alone and
  // it falls back to the single-character entry, which only holds yìng.
  assert.equal(p("应无所住"), "yīng wú suǒ zhù");
  assert.equal(p("应是良辰好景虚设"), "yīng shì liáng chén hǎo jǐng xū shè");
  assert.equal(p("应似飞鸿踏雪泥"), "yīng sì fēi hóng tà xuě ní");
  assert.equal(p("应知故乡事"), "yīng zhī gù xiāng shì");
  // Not only line-initial: the modal sits wherever its predicate does.
  assert.equal(p("春风应笑我"), "chūn fēng yīng xiào wǒ");
  // Compounds the dictionary does list are never reached by this.
  assert.equal(p("应该"), "yīng gāi");
  assert.equal(p("理应如此"), "lǐ yīng rú cǐ");
});

test("应 stays the verb yìng where it cannot be a modal", () => {
  const p = (text: string) => romanizeMandarin(text, { tones: true, joinWords: false });
  // A modal needs a predicate after it, so a final 应 is the verb. 呼之即应 is
  // not a dictionary entry, which is what makes it test the guard rather than
  // the lookup — 有求必应 is one and would pass either way.
  assert.equal(p("呼之即应"), "hū zhī jí yìng");
  assert.equal(p("有求必应"), "yǒu qiú bì yìng");
  // A modal cannot carry aspect.
  assert.equal(p("他应了一声"), "tā yìng le yī shēng");
  // Non-Han after it is the same case as nothing after it.
  assert.equal(p("应 ok"), "yìng ok");
  // The rule only ever looks at a 应 the segmenter left standing alone. Without
  // that check this reads "yīng wēi jī": 应对 is one group of two, and the rule
  // replaces a whole group with one syllable, so 对 is not just mis-read, it is
  // dropped.
  //
  // 应邀前来 was the first fixture here and could not test this, because it is a
  // single four-character dictionary entry with nothing after it — the
  // line-final guard rejected it before the group-length check was reached, and
  // the mutation survived. The fixture needs a following Han word.
  assert.equal(p("应对危机"), "yìng duì wēi jī");
});

test("应和 is a dictionary gap, not a counterexample to the modal rule", () => {
  // Absent from all 828 complete-dict entries containing 应, so the segmenter
  // split it and read yìng hé — wrong in both syllables before the modal rule
  // existed, and the one word that rule would turn into yīng hé.
  assert.equal(romanizeMandarin("应和着风声", { tones: true, joinWords: false }), "yìng hè zhe fēng shēng");
});

test("the modal rule is invisible with tone marks off", () => {
  // The swap is the literal string yìng -> yīng, so nothing to strip afterwards.
  assert.equal(romanizeMandarin("应无所住", { tones: false, joinWords: false }), "ying wu suo zhu");
});

test("a captured lyric line takes the changed tone", () => {
  // 白马过了离原, captured 2026-08-04: 一 before a second tone. 14 of 82
  // captured lines are affected by this, so it is not a corner case.
  assert.equal(
    romanizeMandarin("张伞一抬眼，细雨落额前", { tones: true, joinWords: false }),
    "zhāng sǎn yì tái yǎn, xì yǔ luò é qián",
  );
});
