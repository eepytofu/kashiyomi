// The analyzer-neutral token contract shared with the native backend, plus
// the fail-closed validator: a token stream that cannot be mapped back onto
// the exact analyzed text is rejected outright rather than partially used.
// Pure; no host imports.

export type AnalyzerToken = {
  readonly surface: string;
  /** UTF-16 code-unit offsets into the analyzed line. */
  readonly start: number;
  readonly end: number;
  /** Katakana reading from the dictionary; "" means unknown (abstain). */
  readonly readingKana: string;
  readonly partOfSpeech:
    | "noun"
    | "pronoun"
    | "verb"
    | "auxiliaryVerb"
    | "particle"
    | "suffix"
    | "other";
  readonly morphologyFeatures: readonly string[];
  readonly baseForm: string;
  readonly conjugationType: string;
  readonly conjugationForm: string;
  readonly oov: boolean;
  readonly rawPos: readonly string[];
};

export function assertAnalyzerTokens(text: string, tokens: readonly AnalyzerToken[]): void {
  let previousEnd = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (!Number.isInteger(token.start) || !Number.isInteger(token.end)) {
      throw new Error(`analyzer token ${i} has a non-integer range`);
    }
    if (token.start < previousEnd || token.end < token.start || token.end > text.length) {
      throw new Error(`analyzer token ${i} has an invalid or overlapping range`);
    }
    if (text.slice(token.start, token.end) !== token.surface) {
      throw new Error(`analyzer token ${i} does not match its source range`);
    }
    previousEnd = token.end;
  }
}
