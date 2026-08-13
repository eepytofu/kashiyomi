import { strict as assert } from "node:assert";
import { test } from "node:test";
import { classifyLines } from "../src/engine/lineKinds.ts";
import { hasCreditShape, isCreditLine } from "../src/engine/metadata.ts";

/**
 * 倔强 (五月天), fetched 2026-08-13 from NetEase through the user's private
 * external-source Worker. Provenance differs from `baima.test.ts`: that one is
 * a DOM capture of the running app, this is provider text, so it proves what
 * NetEase serves rather than what NCM renders.
 *
 * It is the regression test for a **trailing** credit block. Every earlier
 * capture put credits at the top, and the classifier reached this one only
 * through `creditRunMembership`, which was the first evidence that no
 * positional model can be trusted.
 *
 * Only the credit block is reproduced: role labels and performer names, which
 * are not the work. The single lyric line kept as the upper boundary is the
 * non-lexical 啦 vocalization, chosen because it carries no protectable
 * expression while still proving the run does not extend past the block.
 */
const JUEJIANG_TAIL = [
  "啦啦啦啦啦啦啦啦",
  "协力：陈建良",
  "钢琴：阿信 / 玛莎",
  "电吉他：怪兽 / 石头",
  "民谣吉他：怪兽",
  "贝斯：玛莎",
  "鼓：冠佑",
  "Loop：石头",
  "和声编写：玛莎",
  "和声：玛莎 / 冠佑",
  "弦乐编曲：阿信 / 玛莎 / 怪兽",
  "弦乐改编：李琪",
  "弦乐演奏：李琪 / 蓝国容 / 马纪伟 / 何君恒 / 吴世杰",
] as const;

test("the trailing block is twelve credits and one lyric", () => {
  const kinds = classifyLines(
    JUEJIANG_TAIL.map((text) => ({ text, translation: "untranslated" as const })),
  );
  assert.equal(kinds[0], "lyric");
  assert.deepEqual(kinds.slice(1), new Array(12).fill("credit"));
});

test("民谣吉他 is a credit on the role table, not only inside the run", () => {
  // It used to fail both tests at once: 吉他 covers 2 of 4 characters, and the
  // shape fallback rejected 他 as a sentence character. Failing both meant the
  // run could not bridge it either, since continuation depends on the shape.
  assert.equal(isCreditLine("民谣吉他：怪兽"), true);
  assert.equal(hasCreditShape("民谣吉他：怪兽"), true);
});

test("a guitar credit is not disqualified by the 他 in 吉他", () => {
  assert.equal(hasCreditShape("电吉他：怪兽 / 石头"), true);
  assert.equal(hasCreditShape("吉他：蔡科俊"), true);
  // 钢 was missing while 琴 was present, so 钢琴 scored 0.50 and needed the run.
  assert.equal(isCreditLine("钢琴：阿信 / 玛莎"), true);
});

test("他 still marks a sentence when it is not part of a role", () => {
  // The exemption is per-character and morpheme-scoped, so the pronoun keeps
  // doing its job: these must not read as credit-shaped labels.
  assert.equal(hasCreditShape("他说：我不会回来了"), false);
  assert.equal(hasCreditShape("我们都是他的孩子：致青春"), false);
});
