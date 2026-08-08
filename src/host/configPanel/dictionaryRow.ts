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
import { nativeFreeSpace, nativeState } from "../native.ts";
import { onPanelTeardown } from "./lifecycle.ts";
import { row, rowText } from "./rows.ts";

function readFreeSpace(): number | undefined {
  const dir = currentAssetPaths()?.dictDir;
  return dir === undefined ? undefined : nativeFreeSpace(dir);
}

function analyzerSegment(): "loading" | "failed" | undefined {
  const state = nativeState().state;
  if (state === "loading") return "loading";
  return state === "failed" || state === "unavailable" ? "failed" : undefined;
}

export function dictionaryRow(): HTMLElement {
  const el = row();
  const text = rowText(t("dictionary"), t("dictNotInstalled"));
  const description = text.querySelector(".kc-desc") ?? text.lastElementChild;
  // No status dot. The analyzer bar directly above already carries one, and a
  // second dot on a downloadable asset says nothing a reader can act on: the
  // description underneath already reads "installed" or "not installed".
  el.appendChild(text);

  // One button, and it never moves. It used to have a Cancel beside it, which
  // the row's `space-between` rendered wedged between the description and the
  // action, and which appeared and vanished inside the ~1s an update check
  // takes. The label is now whatever pressing it would do right now.
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
      // Asked fresh on every paint, never stored. This replaced a status bar
      // above the panel that said the same thing in different words; the row
      // owns what is on disk, so whether the analyzer opened it belongs here
      // too. `ready` and `uninitialized` add nothing: the first is the ordinary
      // case, and the second only happens when there is no dictionary, which
      // the row already says in plainer words.
      analyzer: analyzerSegment(),
    });

  const paint = (): void => {
    if (freeBytes === undefined) freeBytes = readFreeSpace();
    const current = view();

    if (description) description.textContent = describe(current.message);
    primary.textContent = actionLabel(current.primary.action);
    primary.disabled = current.primary.disabled;

    if (current.settling) startPolling();
    scheduleSettle(current.settlesAt);
  };

  // A wait too long to poll through: one timer, cancelled and re-armed on every
  // paint so it can never outlive the state that asked for it.
  let settleTimer: number | undefined;
  const scheduleSettle = (at: number | undefined): void => {
    if (settleTimer !== undefined) {
      window.clearTimeout(settleTimer);
      settleTimer = undefined;
    }
    if (at === undefined) return;
    settleTimer = window.setTimeout(paint, Math.max(at - Date.now(), 0) + 50);
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
    // Read the action rather than tracking a mode: the button is whatever the
    // view says it is at the moment of the press, so the two can never disagree
    // about what it was showing.
    if (view().primary.action.kind === "cancel") {
      cancelDictionaryDownload();
      return;
    }
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
    scheduleSettle(undefined);
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
