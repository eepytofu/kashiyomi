// The dictionary's line in the settings panel: what is installed, and the
// button that does something about it.
//
// It carries the whole feature now. There is one dictionary, so there is
// nothing to choose and nothing to manage — the row that reports the state is
// the right place to act on it, and a dialog for a single button would be a
// dialog for its own sake. What the row shows is the state and one verb:
// `Install` while there is nothing, `Update` once there is.
//
// The setup dialog still exists, but only for first run, where the point is
// telling someone a 69 MB prerequisite is missing before they meet a plugin
// that appears to do nothing.

import { t } from "../i18n.ts";
import {
  cancelDictionaryDownload,
  checkForNewerRelease,
  dictionaryInventory,
  dictionaryJob,
  onDictionaryChange,
} from "../dictionary.ts";
import { startDictionaryInstall } from "../dictionaryInstall.ts";
import { dictionaryRowState } from "../../engine/dictionaryRowState.ts";
import { actionLabel, describe } from "../dictionaryText.ts";
import { currentAssetPaths } from "../annotator.ts";
import { nativeFreeSpace } from "../native.ts";
import { onPanelTeardown } from "./lifecycle.ts";
import { row, rowText } from "./rows.ts";

function readFreeSpace(): number | undefined {
  const dir = currentAssetPaths()?.dictDir;
  return dir === undefined ? undefined : nativeFreeSpace(dir);
}

export function dictionaryRow(): HTMLElement {
  const el = row();
  const text = rowText(t("dictionary"), t("dictNotInstalled"));
  const description = text.querySelector(".kc-desc") ?? text.lastElementChild;
  // No status dot. The analyzer bar directly above already carries one, and a
  // second dot on a downloadable asset says nothing a reader can act on: the
  // description underneath already reads "installed" or "not installed".
  el.appendChild(text);

  // Always in the DOM, shown and hidden rather than added and removed, so
  // starting a download does not change the row's height or shift the button
  // out from under the pointer that just pressed it.
  const cancel = document.createElement("button");
  cancel.className = "kc-button";
  cancel.textContent = t("dictCancel");
  cancel.onclick = () => cancelDictionaryDownload();
  el.appendChild(cancel);

  const primary = document.createElement("button");
  primary.className = "kc-button";
  el.appendChild(primary);

  // Asked once, then again after an install, rather than on every repaint: it
  // is a native call and progress repaints several times a second.
  let freeBytes = readFreeSpace();

  const view = (): ReturnType<typeof dictionaryRowState> =>
    dictionaryRowState({
      inventory: dictionaryInventory(),
      job: dictionaryJob(),
      now: Date.now(),
      freeBytes,
      // This row is where the button is, so it reports its own outcomes.
      ownsJob: true,
    });

  const paint = (): void => {
    if (freeBytes === undefined) freeBytes = readFreeSpace();
    const current = view();

    if (description) description.textContent = describe(current.message);
    primary.textContent = actionLabel(current.primary.action);
    primary.disabled = current.primary.disabled;
    cancel.style.display = current.cancel.shown ? "" : "none";
    cancel.disabled = current.cancel.disabled;

    if (current.settling) startPolling();
  };

  // A cooldown expiring and a progress figure advancing both change the view
  // without anything calling the row, so `settling` is what asks to be
  // repainted on a timer rather than only on a state change.
  let poll: number | undefined;
  const stopPolling = (): void => {
    if (poll === undefined) return;
    window.clearInterval(poll);
    poll = undefined;
  };
  const startPolling = (): void => {
    if (poll !== undefined) return;
    poll = window.setInterval(() => {
      const settling = view().settling;
      paint();
      if (!settling) stopPolling();
    }, 300);
  };

  primary.onclick = () => {
    startPolling();
    void startDictionaryInstall().then(() => {
      // The disk has changed by roughly 207 MB, so the cached answer is stale
      // exactly when it next matters.
      freeBytes = readFreeSpace();
      paint();
    });
  };

  paint();
  // Follow the status wherever it is changed from, including the first-run
  // dialog, and surrender the subscription when the panel is rebuilt.
  const unsubscribe = onDictionaryChange(paint);
  onPanelTeardown(() => {
    unsubscribe();
    stopPolling();
  });

  // Check for a newer release as the panel opens, rather than waiting for a
  // press. Without it the row could only repeat whatever the last manual check
  // found, which is how "already the newest release" came to be shown by
  // something that had checked nothing.
  //
  // Silent on failure: opening settings must not produce an error nobody asked
  // for, and `resolveRelease` falls back to the pinned release reporting
  // `checked: false`, which the view reads as "do not claim to know".
  if (dictionaryInventory().installed) void checkForNewerRelease();

  return el;
}
