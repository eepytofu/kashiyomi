// The AI translation lane: one request per song, and the rows it produces.
//
// Separate from NCM's own 译 lane, which is never overwritten. Our rows are
// <div>s *inside* the lyric <p>, so hasProviderTranslationSibling never
// mistakes them for the player's translation.

import { shouldDisplayTranslation } from "../engine/aiTranslation.ts";
import { hasProviderTranslationSibling } from "./lyricDom.ts";
import { ROW_CLASS } from "./render.ts";
import { getSettings } from "./settings.ts";
import { translateSong, translationConfigured } from "./translator.ts";
import { log } from "./log.ts";

export type OriginalLine = { el: HTMLElement; text: string };

let txAbort: AbortController | undefined;
let txDocKey = "";
const txByText = new Map<string, string>();

/** Forget the current song's translation state (call when AI settings change). */
export function resetTranslation(): void {
  txAbort?.abort();
  txAbort = undefined;
  txDocKey = "";
  txByText.clear();
}

function attachTranslationRows(originals: readonly OriginalLine[]): void {
  if (txByText.size === 0) return;
  for (const { el, text } of originals) {
    const translated = txByText.get(text);
    if (!translated) continue;
    if (el.querySelector(".kashiyomi-tx")) continue;
    // NCM's own translation (tlyric) outranks the AI lane; never double up.
    if (hasProviderTranslationSibling(el)) continue;
    const row = document.createElement("div");
    row.className = `${ROW_CLASS} kashiyomi-tx`;
    row.textContent = translated;
    el.appendChild(row);
  }
}

/**
 * Attach whatever has already been translated, and start a request for the
 * song if one is warranted. `onTranslated` runs when new output arrives, so
 * the caller can rescan and attach it.
 */
export function maybeTranslate(
  originals: readonly OriginalLine[],
  onTranslated: () => void,
): void {
  attachTranslationRows(originals);
  const settings = getSettings();
  if (!settings.aiAutoTranslate || !translationConfigured()) return;
  if (originals.length < 2) return;
  const texts = originals.map((entry) => entry.text);
  const docKey = texts.join("\n");
  if (docKey === txDocKey) return; // already translated, in flight, or failed once
  txDocKey = docKey;
  txAbort?.abort();
  const controller = new AbortController();
  txAbort = controller;
  void (async () => {
    const translated = await translateSong(texts, {}, controller.signal);
    if (!translated || controller.signal.aborted) return;
    txByText.clear();
    for (let i = 0; i < texts.length; i++) {
      const source = texts[i]!;
      const target = translated[i] ?? "";
      if (shouldDisplayTranslation(source, target)) txByText.set(source, target);
    }
    log.info(`translation ready for ${txByText.size} lines`);
    onTranslated();
  })();
}
