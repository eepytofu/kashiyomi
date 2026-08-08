// Keyboard behaviour for the settings panel's dropdown, without a DOM.
//
// The dropdown replaced a native <select>, which cost about a second of blocked
// main thread per open on CEF 91. Everything the platform control gave us for
// free now has to be written, and the two parts with real edge cases are here so
// they can be tested: which option a key moves to, and where typing a letter
// lands.

/** Keys that move the highlight. Anything else is not this module's business. */
export type MoveKey = "ArrowUp" | "ArrowDown" | "Home" | "End" | "PageUp" | "PageDown";

/** How far Page Up/Down jumps, matching roughly a screenful of the popup. */
const PAGE = 8;

export function isMoveKey(key: string): key is MoveKey {
  return (
    key === "ArrowUp" ||
    key === "ArrowDown" ||
    key === "Home" ||
    key === "End" ||
    key === "PageUp" ||
    key === "PageDown"
  );
}

/**
 * Where a movement key lands.
 *
 * Clamps rather than wraps, which is what a Windows select does: Arrow Down on
 * the last option stays put instead of jumping back to the top.
 *
 * `current` may be -1 when nothing is selected yet, so Arrow Down opens on the
 * first option rather than the second.
 */
export function nextIndex(current: number, key: MoveKey, count: number): number {
  if (count <= 0) return -1;
  const last = count - 1;
  const clamp = (n: number): number => (n < 0 ? 0 : n > last ? last : n);

  switch (key) {
    case "ArrowUp":
      return current <= 0 ? 0 : clamp(current - 1);
    case "ArrowDown":
      return current < 0 ? 0 : clamp(current + 1);
    case "Home":
      return 0;
    case "End":
      return last;
    case "PageUp":
      return clamp((current < 0 ? 0 : current) - PAGE);
    case "PageDown":
      return clamp((current < 0 ? 0 : current) + PAGE);
  }
}

/**
 * Where typing lands, or -1 when nothing matches.
 *
 * Searches from just after `from` and wraps once, so pressing the same letter
 * repeatedly cycles through the options starting with it — the behaviour a
 * native select has and the reason this is worth having at all with 15 target
 * languages.
 *
 * Case-insensitive, and it must simply miss rather than misbehave on labels that
 * cannot match an ASCII prefix: 简体中文, 한국어 and العربية are all real entries
 * in that list, and typing "e" must not land on one of them.
 */
export function typeAheadIndex(
  options: readonly { readonly label: string; readonly search?: string }[],
  buffer: string,
  from: number,
): number {
  const needle = buffer.toLowerCase();
  if (needle === "" || options.length === 0) return -1;

  // Repeating one letter cycles; typing several characters refines the current
  // match instead, so a buffer past its first character may land where it is.
  const start = buffer.length === 1 ? from + 1 : from;

  for (let step = 0; step < options.length; step++) {
    const index = (((start + step) % options.length) + options.length) % options.length;
    const option = options[index];
    if (option === undefined) continue;
    // `search` is how a list of endonyms stays reachable from a Latin keyboard:
    // 日本語 is found by "japanese", which is the only prefix most people can type.
    if (option.label.toLowerCase().startsWith(needle)) return index;
    if (option.search !== undefined && option.search.toLowerCase().startsWith(needle)) return index;
  }
  return -1;
}

/**
 * How long a type-ahead buffer survives between keystrokes.
 *
 * Long enough to type "de" as one search, short enough that coming back later
 * and pressing "e" starts a new one.
 */
export const TYPE_AHEAD_RESET_MS = 700;
