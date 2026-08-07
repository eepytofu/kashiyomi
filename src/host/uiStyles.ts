// The bits of chrome the settings panel and the setup dialog both use.
//
// They looked like two different products: the dialog had its own radius, its
// own button padding, its own row shape and its own label weight, because it
// was written self-contained. It had to be, since on first run there is no
// settings panel in the document to have injected anything, so it could not
// simply reuse `PANEL_CSS`.
//
// Declaring the shared primitives once and injecting them from both surfaces
// fixes the cause rather than the symptom. Syncing two copies by hand would
// have held for exactly as long as nobody edited one of them.
//
// Anything genuinely local stays local: the panel keeps its grid, switches,
// selects and preview; the dialog keeps its modal box, backdrop and radios.

/**
 * Carried by both roots, and the reason every rule below is scoped to it.
 *
 * Scoped rather than global because this stylesheet lives in `document.head`
 * alongside NetEase's own, and an unscoped `.kc-button` would be the plugin
 * reaching into a page it does not own.
 */
export const UI_ROOT_CLASS = "kashiyomi-ui";

export const SHARED_CSS = `
.kashiyomi-ui * { box-sizing: border-box; }
.kashiyomi-ui .kc-card { border-radius: 10px; background: rgba(255, 255, 255, 0.05); overflow: hidden; }
.kashiyomi-ui .kc-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 11px 14px; cursor: pointer; }
.kashiyomi-ui .kc-row + .kc-row { border-top: 1px solid rgba(255, 255, 255, 0.06); }
.kashiyomi-ui .kc-row:hover { background: rgba(255, 255, 255, 0.04); }
/* Weight separates label from description, not opacity. The two were 13.5px and
   12px, a 1.125 ratio and near-identical, so the whole hierarchy rested on
   opacity, which is also what sets contrast. That made the two impossible to
   tune apart: every step towards legibility flattened the hierarchy. With the
   label carrying its own weight, opacity is free to serve contrast alone. */
.kashiyomi-ui .kc-label { font-size: 13.5px; font-weight: 500; line-height: 1.3; }
.kashiyomi-ui .kc-desc { font-size: 12px; opacity: 0.68; margin-top: 2px; line-height: 1.35; }
/* A control that cannot do anything yet, rather than one that is hidden. It
   stays readable so the surface does not change shape when a dictionary
   arrives, and its controls are genuinely disabled so nothing can be switched
   into a state that silently has no effect. */
.kashiyomi-ui .kc-inert { opacity: 0.45; cursor: default; }
.kashiyomi-ui .kc-inert:hover { background: transparent; }
.kashiyomi-ui .kc-button {
  padding: 6px 14px; border: none; border-radius: 8px;
  background: rgba(255, 255, 255, 0.1); color: inherit;
  font-size: 12.5px; font-family: inherit; cursor: pointer;
}
.kashiyomi-ui .kc-button:hover:not(:disabled) { background: rgba(255, 255, 255, 0.16); }
.kashiyomi-ui .kc-button:disabled { opacity: 0.5; cursor: default; }
.kashiyomi-ui .kc-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; background: #999; }
.kashiyomi-ui .kc-ready .kc-dot { background: #52c41a; }
.kashiyomi-ui .kc-bad .kc-dot { background: #ff4d4f; }
.kashiyomi-ui .kc-loading .kc-dot { background: #faad14; }
.kashiyomi-ui .kc-button:focus-visible { outline: 2px solid rgba(236, 65, 65, 0.75); outline-offset: 2px; }
`;

/**
 * Put the shared sheet in the document once.
 *
 * In `document.head` rather than inside either surface, because the dialog
 * outlives a panel rebuild and the panel wipes its own root on every render.
 */
export function ensureSharedStyles(): void {
  if (document.getElementById("kashiyomi-ui-css")) return;
  const style = document.createElement("style");
  style.id = "kashiyomi-ui-css";
  style.textContent = SHARED_CSS;
  document.head.appendChild(style);
}
