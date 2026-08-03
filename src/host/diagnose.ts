// Layout diagnostics. Reading annotations sit inside NetEase's own lyric
// markup, so before changing any CSS we need to know how that markup is laid
// out. Everything here only reads; nothing is modified.
//
// The question this has to answer is narrow: are the reported gaps produced by
// our ruby, or are they NetEase's own line spacing? One earlier report turned
// out to be NCM's, so every ruby measurement is paired with the same
// measurement taken on an unannotated line as a control.

import { ROW_CLASS } from "./render.ts";
import { log } from "./log.ts";

function describe(el: Element, label: string): Record<string, string> {
  const style = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return {
    label,
    tag: el.tagName.toLowerCase(),
    display: style.display,
    flexDirection: style.flexDirection,
    justifyContent: style.justifyContent,
    alignItems: style.alignItems,
    gap: style.gap,
    letterSpacing: style.letterSpacing,
    wordSpacing: style.wordSpacing,
    textAlign: style.textAlign,
    textAlignLast: style.textAlignLast,
    whiteSpace: style.whiteSpace,
    fontSize: style.fontSize,
    width: rect.width.toFixed(1),
    height: rect.height.toFixed(1),
  };
}

/**
 * Width the given characters occupy when laid out plainly inside `host`, so
 * they inherit the same font. `white-space: pre` keeps it on one line and
 * stops the trailing/leading spaces of a lyric from being collapsed.
 */
function probeWidth(host: Element, text: string): number {
  const probe = document.createElement("span");
  probe.textContent = text;
  probe.style.cssText =
    "position:absolute;visibility:hidden;white-space:pre;left:-9999px;top:0;";
  host.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width;
}

/** Advance width of a line's inline content, ignoring our appended rows. */
function inlineWidth(line: Element): number {
  const range = document.createRange();
  let width = 0;
  for (let node = line.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (el.classList.contains(ROW_CLASS)) continue;
      width += el.getBoundingClientRect().width;
    } else if (node.nodeType === Node.TEXT_NODE) {
      range.selectNode(node);
      width += range.getBoundingClientRect().width;
    }
  }
  return width;
}

/** The text a line shows, with our readings and reading rows stripped out. */
function displayTextOf(line: Element): string {
  const clone = line.cloneNode(true) as HTMLElement;
  for (const node of clone.querySelectorAll(`.${ROW_CLASS}, rt`)) node.remove();
  return clone.textContent ?? "";
}

/** The ruby's base characters: its child text nodes, excluding the <rt>. */
function rubyBase(ruby: Element): string {
  let base = "";
  for (let node = ruby.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === Node.TEXT_NODE) base += node.textContent ?? "";
  }
  return base;
}

type RubyMeasurement = {
  base: string;
  reading: string;
  rubyWidth: number;
  plainWidth: number;
  readingWidth: number;
  stretch: number;
};

function measureRuby(ruby: Element, host: Element): RubyMeasurement | undefined {
  const rt = ruby.querySelector("rt");
  const base = rubyBase(ruby);
  if (base === "") return undefined;
  const plainWidth = probeWidth(host, base);
  if (plainWidth === 0) return undefined;
  return {
    base,
    reading: rt?.textContent ?? "",
    rubyWidth: ruby.getBoundingClientRect().width,
    plainWidth,
    readingWidth: rt?.getBoundingClientRect().width ?? 0,
    stretch: ruby.getBoundingClientRect().width - plainWidth,
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Dump how annotated lyric lines are laid out: the line element and its
 * ancestors, how much each ruby stretches its base beyond the same characters
 * unannotated, and the same width comparison on a line we did not touch.
 *
 * Returns false when the lyric panel is not laid out yet (every width comes
 * back zero), so the caller can try again rather than record a useless dump.
 */
export function diagnoseLayout(): boolean {
  const annotated = Array.from(
    document.querySelectorAll("ul.lyric li p"),
  ).filter((el) => el.querySelector("ruby.kashiyomi-ruby"));

  const line = annotated[0] ?? document.querySelector("ul.lyric li p");
  if (!line) {
    log.info("diagnose: no lyric line found");
    return false;
  }
  if (line.getBoundingClientRect().width === 0) {
    log.info("diagnose: lyric panel not laid out yet, deferring");
    return false;
  }

  const chain: Record<string, string>[] = [describe(line, "line")];
  let parent = line.parentElement;
  for (let depth = 0; parent && depth < 3; depth++) {
    chain.push(describe(parent, `ancestor${depth + 1}`));
    parent = parent.parentElement;
  }
  for (const entry of chain) log.info("diagnose", JSON.stringify(entry));

  const row = line.querySelector(`.${ROW_CLASS}`);
  if (row) log.info("diagnose", JSON.stringify(describe(row, "readingRow")));

  // Control: a line with no ruby of ours. If its rendered width already
  // exceeds a plain probe of the same characters, the extra space is NCM's
  // and not something our markup introduced.
  const plainLine = Array.from(document.querySelectorAll("ul.lyric li p")).find(
    (el) =>
      !el.querySelector("ruby.kashiyomi-ruby") &&
      (el.textContent ?? "").trim() !== "",
  );
  if (plainLine) {
    const text = displayTextOf(plainLine);
    const actual = inlineWidth(plainLine);
    const plain = probeWidth(plainLine, text);
    log.info(
      "diagnose control (unannotated line)",
      JSON.stringify({
        text,
        renderedWidth: round(actual),
        plainProbeWidth: round(plain),
        excess: round(actual - plain),
        letterSpacing: getComputedStyle(plainLine).letterSpacing,
      }),
    );
  } else {
    log.info("diagnose control: every visible line is annotated, no control available");
  }

  // Per-line: does our markup widen the line as a whole, and by how much?
  let measuredAny = false;
  for (const el of annotated.slice(0, 6)) {
    const text = displayTextOf(el);
    const actual = inlineWidth(el);
    const plain = probeWidth(el, text);
    if (plain === 0) continue;
    measuredAny = true;
    log.info(
      "diagnose line",
      JSON.stringify({
        text,
        annotatedWidth: round(actual),
        plainWidth: round(plain),
        widenedBy: round(actual - plain),
        percent: round(((actual - plain) / plain) * 100),
      }),
    );
  }

  // Per-ruby, worst offenders first: which readings are wider than their base.
  const measurements: RubyMeasurement[] = [];
  for (const el of annotated) {
    for (const ruby of el.querySelectorAll("ruby.kashiyomi-ruby")) {
      const measurement = measureRuby(ruby, el);
      if (measurement) measurements.push(measurement);
    }
  }
  measurements.sort((a, b) => b.stretch - a.stretch);
  for (const m of measurements.slice(0, 8)) {
    log.info(
      "diagnose ruby",
      JSON.stringify({
        base: m.base,
        reading: m.reading,
        baseWidthWithRuby: round(m.rubyWidth),
        baseWidthPlain: round(m.plainWidth),
        readingWidth: round(m.readingWidth),
        stretchedBy: round(m.stretch),
      }),
    );
  }
  if (measurements.length > 0) {
    const first = measurements[0]!;
    const ruby = annotated[0]?.querySelector("ruby.kashiyomi-ruby");
    log.info(
      "diagnose summary",
      JSON.stringify({
        annotatedLines: annotated.length,
        rubiesMeasured: measurements.length,
        stretchedRubies: measurements.filter((m) => m.stretch > 0.5).length,
        worstStretch: round(first.stretch),
        worstBase: first.base,
        rubyDisplay: ruby ? getComputedStyle(ruby).display : "none",
        rtDisplay: ruby?.querySelector("rt")
          ? getComputedStyle(ruby.querySelector("rt")!).display
          : "none",
      }),
    );
  }

  return measuredAny || measurements.length > 0;
}
