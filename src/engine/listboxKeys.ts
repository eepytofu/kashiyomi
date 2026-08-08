// Keyboard behaviour for the settings panel's dropdown, without a DOM.

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

/** Where a movement key lands. */
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

/** Where typing lands, or -1 when nothing matches. */
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

/** How long a type-ahead buffer survives between keystrokes. */
export const TYPE_AHEAD_RESET_MS = 700;
