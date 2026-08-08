// Copying a lyric line should yield the lyric, not our annotations.

import { ROW_CLASS } from "./render.ts";

/**
 * Rewrite copies made inside the lyric list, dropping our readings and reading
 * rows. Partial selections are preserved: the selected fragment is cloned and
 * stripped rather than substituted with whole lines.
 */
export function installCopyHandler(): void {
  // Capture phase, and stop other listeners: NetEase installs its own copy
  // handler on the lyric page, and whichever runs last wins the clipboard.
  document.addEventListener("copy", (event: ClipboardEvent) => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const container =
      range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? (range.commonAncestorContainer as Element)
        : range.commonAncestorContainer.parentElement;
    // Leave every other selection on the page alone.
    if (!container?.closest("ul.lyric")) return;

    const fragment = range.cloneContents();
    const ours = fragment.querySelectorAll(`rt, .${ROW_CLASS}`);
    if (ours.length === 0) return;
    for (const node of ours) node.remove();

    // A selection spanning several lines clones the <p>s themselves, and each
    // is a line of its own. A selection inside one line clones only that
    // line's children, so there is no <p> and the whole fragment is the line.
    const paragraphs = fragment.querySelectorAll("p");
    const text =
      paragraphs.length > 0
        ? Array.from(paragraphs)
            .map((p) => (p.textContent ?? "").trim())
            .filter((line) => line !== "")
            .join("\n")
        : (fragment.textContent ?? "").trim();
    if (text === "") return;

    event.clipboardData?.setData("text/plain", text);
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}
