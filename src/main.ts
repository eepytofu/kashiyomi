// Kashiyomi entry point. BetterNCM injects this (bundled) file into the Main page.

declare const plugin: {
  onLoad(fn: () => void): void;
  onConfig(fn: () => HTMLElement): void;
};

plugin.onLoad(() => {
  console.log("[Kashiyomi] loaded (scaffold)");
});

plugin.onConfig(() => {
  const root = document.createElement("div");
  root.textContent = "Kashiyomi: nothing configurable yet.";
  return root;
});
