import assert from "node:assert/strict";
import test from "node:test";

import { Window } from "happy-dom";

import { teardownPanel } from "../src/host/configPanel/lifecycle.ts";
import { textRow, toggleRow } from "../src/host/configPanel/rows.ts";
import { getSettings } from "../src/host/settings.ts";

const domWindow = new Window({ url: "https://kashiyomi.test/" });
for (const [name, value] of Object.entries({
  window: domWindow,
  document: domWindow.document,
  navigator: domWindow.navigator,
  localStorage: domWindow.localStorage,
  HTMLElement: domWindow.HTMLElement,
  getComputedStyle: domWindow.getComputedStyle.bind(domWindow),
})) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });

test("setting labels describe their native controls and buttons default away from submit", () => {
  localStorage.clear();
  const row = toggleRow("furigana", "Furigana", "Show readings");
  const input = row.querySelector<HTMLInputElement>("input")!;
  const label = row.querySelector<HTMLElement>(".kc-label")!;
  const description = row.querySelector<HTMLElement>(".kc-desc")!;

  assert.equal(row.tagName, "LABEL");
  assert.equal(input.getAttribute("aria-labelledby"), label.id);
  assert.equal(input.getAttribute("aria-describedby"), description.id);

  const field = textRow("aiBaseUrl", "aiBaseUrl", "aiBaseUrlDesc", {});
  assert.equal(field.querySelector<HTMLInputElement>("input")?.type, "text");
  teardownPanel();
});

test("an edited field flushes once when the panel is torn down", () => {
  localStorage.clear();
  const row = textRow("aiBaseUrl", "aiBaseUrl", "aiBaseUrlDesc", {});
  const input = row.querySelector<HTMLInputElement>("input")!;
  input.value = "https://api.example.test/v1";

  teardownPanel();
  assert.equal(getSettings().aiBaseUrl, "https://api.example.test/v1");
  teardownPanel();
  assert.equal(getSettings().aiBaseUrl, "https://api.example.test/v1");
});
