// The bits of chrome the settings panel and the setup dialog both use.

/** Carried by both roots, and the reason every rule below is scoped to it. */
export const UI_ROOT_CLASS = "kashiyomi-ui";

export const SHARED_CSS = `
.kashiyomi-ui * { box-sizing: border-box; }
.kashiyomi-ui .kc-card {
  border: 1px solid var(--kc-card-border, transparent); border-radius: 10px;
  background: var(--kc-card-bg, rgba(255, 255, 255, 0.05)); overflow: hidden;
}
.kashiyomi-ui .kc-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 11px 14px; }
.kashiyomi-ui .kc-row + .kc-row { border-top: 1px solid var(--kc-divider, rgba(255, 255, 255, 0.06)); }
/* No row is clickable: every row's control is its own hit target, which is what
   the rest of the panel already did and what NCM's own plugins do. A row-wide
   hover would advertise a target that is not there. */
/* Weight separates label from description, not opacity. The two were 13.5px and
   12px, a 1.125 ratio and near-identical, so the whole hierarchy rested on
   label carrying its own weight, opacity is free to serve contrast alone. */
.kashiyomi-ui .kc-label { font-size: 13.5px; font-weight: 500; line-height: 1.3; }
.kashiyomi-ui .kc-desc { font-size: 12px; opacity: 0.68; margin-top: 2px; line-height: 1.35; }
/* A control that cannot do anything yet, rather than one that is hidden. It
   stays readable so the surface does not change shape when a dictionary
   into a state that silently has no effect. */
.kashiyomi-ui .kc-inert { opacity: 0.45; cursor: default; }
.kashiyomi-ui .kc-inert .kc-switch { cursor: default; }
/* Radius 8, matching every other surface here — card 10, select 8, input 8,
   language toggle 8. Shipped once as NCM's own pill (radius = half the height)
   and reverted: it was the only control in the panel not on the shared radius. */
.kashiyomi-ui .kc-button {
  padding: 6px 14px; border: none;
  border-radius: 8px; background: var(--kc-button-bg, rgba(255, 255, 255, 0.1)); color: inherit;
  font-size: 12.5px; font-family: inherit; cursor: pointer;
}
.kashiyomi-ui .kc-button:hover:not(:disabled) { background: var(--kc-button-hover, rgba(255, 255, 255, 0.16)); }
.kashiyomi-ui .kc-button:disabled { opacity: 0.5; cursor: default; }
.kashiyomi-ui .kc-dictionary-manage { height: 28px; padding: 0 14px; border-radius: 14px; }
.kashiyomi-ui .kc-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; background: #999; }
.kashiyomi-ui .kc-ready .kc-dot { background: #52c41a; }
.kashiyomi-ui .kc-bad .kc-dot { background: #ff4d4f; }
.kashiyomi-ui .kc-loading .kc-dot { background: #faad14; }
.kashiyomi-ui .kc-button:focus-visible { outline: 2px solid rgba(255, 58, 58, 0.75); outline-offset: 2px; }
`;

/** Put the shared sheet in the document once. */
export function ensureSharedStyles(): void {
  if (document.getElementById("kashiyomi-ui-css")) return;
  const style = document.createElement("style");
  style.id = "kashiyomi-ui-css";
  style.textContent = SHARED_CSS;
  document.head.appendChild(style);
}
