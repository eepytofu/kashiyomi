// Layout diagnostics. Reading annotations sit inside NetEase's own lyric
// markup, so before changing any CSS we need to know how that markup is laid
// out. Everything here only reads; nothing is modified.

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
    whiteSpace: style.whiteSpace,
    fontSize: style.fontSize,
    width: rect.width.toFixed(1),
    height: rect.height.toFixed(1),
  };
}

/**
 * Dump how an annotated lyric line is laid out: the line element, its
 * ancestors, and the width a ruby actually occupies against the width of the
 * same characters without a reading. Ruby widens its base when the reading is
 * wider, and this reports by how much.
 */
export function diagnoseLayout(): void {
  const ruby = document.querySelector("ruby.kashiyomi-ruby");
  const line = ruby?.closest("p") ?? document.querySelector("ul.lyric li p");
  if (!line) {
    log.info("diagnose: no lyric line found");
    return;
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

  if (ruby) {
    const rt = ruby.querySelector("rt");
    const base = (ruby.textContent ?? "").replace(rt?.textContent ?? "", "");
    // Measure the same characters without ruby to see how much the reading
    // stretched the base text.
    const probe = document.createElement("span");
    probe.textContent = base;
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;";
    line.appendChild(probe);
    const plain = probe.getBoundingClientRect().width;
    probe.remove();
    const rubyRect = ruby.getBoundingClientRect();
    const rtWidth = rt?.getBoundingClientRect().width ?? 0;
    log.info(
      "diagnose ruby",
      JSON.stringify({
        base,
        reading: rt?.textContent ?? "",
        baseWidthWithRuby: rubyRect.width.toFixed(1),
        baseWidthPlain: plain.toFixed(1),
        readingWidth: rtWidth.toFixed(1),
        stretchedBy: (rubyRect.width - plain).toFixed(1),
        rubyDisplay: getComputedStyle(ruby).display,
        rtDisplay: rt ? getComputedStyle(rt).display : "none",
      }),
    );
  }
}
