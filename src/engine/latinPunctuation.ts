// Punctuation for romanized output. Pure; no host imports.

const CJK_TO_LATIN = new Map([
  ["，", ","],
  // The Chinese enumeration comma and the Japanese comma both romanize as a
  // plain comma; neither has a distinct Latin mark.
  ["、", ","],
  ["。", "."],
  ["！", "!"],
  ["？", "?"],
  ["；", ";"],
  ["：", ":"],
  ["（", "("],
  ["）", ")"],
  ["【", "["],
  ["】", "]"],
  ["《", '"'],
  ["》", '"'],
  ["「", '"'],
  ["」", '"'],
  ["『", "'"],
  ["』", "'"],
  // A middle dot separates names in CJK; a space does the same job in Latin.
  ["・", " "],
  ["·", " "],
  // The ideographic space is a Han-typography glyph one em wide. Lyrics use it
  // to break a line into phrases, and left alone it renders as a gulf in the
  // middle of a romaji row: "koyoi mo ten wa 　 akaruku".
  ["　", " "],
]);

/** Marks that attach to the word before them, so no space may precede. */
const CLOSING = ',.!?;:)]"\'';
/** Marks that attach to the word after them, so no space may follow. */
const OPENING = '([';
/** Marks that take a following space when more text comes after. */
const NEEDS_TRAILING_SPACE = ",.!?;:";

function mapMarks(text: string): string {
  let out = "";
  for (const ch of text) out += CJK_TO_LATIN.get(ch) ?? ch;
  return out;
}

/** Spacing fixes inside one string. Does not trim, so segment edges survive. */
function spaceMarks(text: string): string {
  return text
    .replace(/[ \t]+([,.!?;:)\]"'])/gu, "$1")
    .replace(/([,.!?;:])(?=[^\s,.!?;:])/gu, "$1 ")
    .replace(/([([])[ \t]+/gu, "$1")
    .replace(/[ \t]{2,}/gu, " ");
}

/**
 * Convert CJK punctuation to Latin and fix the spacing around it. For a
 * romanization that is already one joined string.
 */
export function toLatinPunctuation(text: string): string {
  return spaceMarks(mapMarks(text)).trim();
}

/**
 * The same, over romaji segments. The renderer draws authored readings from
 */
export function latinizeSegments<T extends { text: string }>(segments: readonly T[]): T[] {
  const out = segments.map((segment) => ({ ...segment, text: spaceMarks(mapMarks(segment.text)) }));
  for (let i = 0; i < out.length - 1; i++) {
    const current = out[i]!;
    const next = out[i + 1]!;
    if (next.text !== "" && CLOSING.includes(next.text[0]!)) {
      current.text = current.text.replace(/[ \t]+$/u, "");
    }
    const last = current.text[current.text.length - 1] ?? "";
    if (OPENING.includes(last)) next.text = next.text.replace(/^[ \t]+/u, "");
    else if (NEEDS_TRAILING_SPACE.includes(last) && next.text !== "" && !/^\s/u.test(next.text)) {
      next.text = ` ${next.text}`;
    } else if (last === " " || last === "\t") {
      // A space ending one segment and another starting the next join into a
      // double space that neither segment's own pass can see, because each is
      // collapsed on its own. With reading hints off this is the normal case:
      next.text = next.text.replace(/^[ \t]+/u, "");
    }
  }
  const first = out[0];
  if (first) first.text = first.text.replace(/^[ \t]+/u, "");
  const final = out[out.length - 1];
  if (final) final.text = final.text.replace(/[ \t]+$/u, "");
  return out;
}
