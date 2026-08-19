import assert from "node:assert/strict";
import test from "node:test";

import { Window } from "happy-dom";

import type { DictionarySnapshot } from "../src/engine/dictionaryState.ts";
import {
  createDictionaryDialog,
  type DictionaryDialogDependencies,
} from "../src/host/setup/dialog.ts";

const domWindow = new Window({ url: "https://kashiyomi.test/" });
for (const [name, value] of Object.entries({
  window: domWindow,
  document: domWindow.document,
  navigator: domWindow.navigator,
  localStorage: domWindow.localStorage,
  HTMLElement: domWindow.HTMLElement,
  getComputedStyle: domWindow.getComputedStyle.bind(domWindow),
})) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });

const EMPTY: DictionarySnapshot = {
  configured: true,
  installed: [],
  analyzer: { state: "uninitialized" },
};

const DUAL: DictionarySnapshot = {
  configured: true,
  active: "core",
  installed: [
    { edition: "core", version: "current", dictionaryBytes: 10, active: true, pinnedVersion: "current", updateAvailable: false },
    { edition: "full", version: "current", dictionaryBytes: 20, active: false, pinnedVersion: "current", updateAvailable: false },
  ],
  analyzer: { state: "ready" },
};

function harness(initial: DictionarySnapshot, overrides: Partial<DictionaryDialogDependencies> = {}) {
  let snapshot = initial;
  let answered = false;
  let listener: (() => void) | undefined;
  const dependencies: DictionaryDialogDependencies = {
    snapshot: () => snapshot,
    subscribe: (next) => { listener = next; return () => { listener = undefined; }; },
    install: () => ({ ok: true, value: 1 }),
    activate: () => ({ ok: true, value: 2 }),
    remove: () => ({ ok: true, value: 3 }),
    cancel: () => ({ ok: true, value: true }),
    setupAnswered: () => answered,
    acknowledgeSetup: () => { answered = true; },
    ...overrides,
  };
  return {
    dependencies,
    setSnapshot(next: DictionarySnapshot) { snapshot = next; listener?.(); },
    answered: () => answered,
  };
}

function button(root: ParentNode, label: string): HTMLButtonElement {
  const match = Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => !candidate.hidden && candidate.textContent === label);
  assert.ok(match, `button ${label} should be visible`);
  return match;
}

test("progress ticks retain the same DOM nodes and focused action", () => {
  const running: DictionarySnapshot = {
    ...DUAL,
    operation: { id: 8, kind: "install", edition: "full", state: "running", phase: "downloading", done: 10, total: 100, cancellable: true },
  };
  const state = harness(running);
  const controller = createDictionaryDialog({}, state.dependencies);
  document.body.appendChild(controller.dialog);
  const track = controller.dialog.querySelector<HTMLElement>(".kd-track")!;
  const cancel = button(controller.dialog, "Cancel");
  cancel.focus();

  state.setSnapshot({
    ...running,
    operation: { ...running.operation!, done: 61 },
  });

  assert.equal(controller.dialog.querySelector(".kd-track"), track);
  assert.equal(button(controller.dialog, "Cancel"), cancel);
  assert.equal(document.activeElement, cancel);
  assert.equal(track.getAttribute("aria-valuenow"), "61");
  controller.destroy();
});

test("accepted commands latch immediately and first-run acknowledgement waits for acceptance", () => {
  let installs = 0;
  let reject = true;
  const state = harness(EMPTY, {
    install: () => {
      installs++;
      return reject ? { ok: false, errorCode: "offline" } : { ok: true, value: 12 };
    },
  });
  const controller = createDictionaryDialog({ firstRun: true }, state.dependencies);
  document.body.appendChild(controller.dialog);

  button(controller.dialog, "Install Core").click();
  assert.equal(state.answered(), false);
  assert.match(controller.dialog.querySelector(".kd-feedback")?.textContent ?? "", /download source/u);

  reject = false;
  const install = button(controller.dialog, "Install Core");
  install.click();
  install.click();
  assert.equal(installs, 2, "one rejected attempt and one accepted attempt");
  assert.equal(state.answered(), true);
  assert.equal(install.disabled, true);
  controller.destroy();
});

test("cancel rejection is reported while the durable operation remains visible", () => {
  const running: DictionarySnapshot = {
    ...EMPTY,
    operation: { id: 4, kind: "install", edition: "core", state: "running", phase: "connecting", done: 0, total: 0, cancellable: true },
  };
  const state = harness(running, { cancel: () => ({ ok: true, value: false }) });
  const controller = createDictionaryDialog({}, state.dependencies);
  document.body.appendChild(controller.dialog);

  button(controller.dialog, "Cancel").click();
  assert.equal(controller.dialog.querySelector<HTMLElement>(".kd-progress")?.hidden, false);
  assert.match(controller.dialog.querySelector(".kd-feedback")?.textContent ?? "", /no longer be cancelled/u);
  controller.destroy();
});

test("Escape from removal confirmation returns to management", () => {
  const state = harness(DUAL);
  const controller = createDictionaryDialog({}, state.dependencies);
  document.body.appendChild(controller.dialog);
  const core = controller.dialog.querySelector<HTMLElement>("[data-edition='core']")!;
  button(core, "Remove…").click();
  assert.equal(controller.dialog.querySelector<HTMLElement>(".kd-confirm")?.hidden, false);

  const event = new domWindow.Event("cancel", { cancelable: true });
  controller.dialog.dispatchEvent(event as unknown as Event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(controller.dialog.querySelector<HTMLElement>(".kd-list")?.hidden, false);
  controller.destroy();
});
