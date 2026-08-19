// The bits of chrome the settings panel and the setup dialog both use.

/** Carried by both roots, and the reason every rule below is scoped to it. */
export const UI_ROOT_CLASS = "kashiyomi-ui";

export const SHARED_CSS = `
.kashiyomi-ui {
  --ky-accent: rgb(255, 58, 58);
  --ky-accent-hover: rgb(255, 78, 78);
  --ky-danger: rgb(255, 92, 92);
  --ky-text: var(--colorBlack2, rgba(255, 255, 255, .9));
  --ky-text-strong: var(--colorBlack1, #fff);
  --ky-muted: var(--colorBlack6, rgba(255, 255, 255, .5));
  --ky-faint: var(--colorBlack8, rgba(255, 255, 255, .3));
  --ky-divider: var(--colorBlack11, rgba(255, 255, 255, .06));
  --ky-surface: var(--colorBlack11, rgba(255, 255, 255, .06));
  --ky-control: transparent;
  --ky-control-hover: var(--colorBlack11, rgba(255, 255, 255, .06));
  --ky-control-border: var(--colorBlack8, rgba(255, 255, 255, .3));
  --ky-focus: rgba(255, 58, 58, .78);
  color: var(--ky-text);
}
.kashiyomi-ui.kui-light {
  --ky-text: rgba(24, 29, 39, .9);
  --ky-text-strong: rgb(24, 29, 39);
  --ky-muted: rgba(24, 29, 39, .58);
  --ky-faint: rgba(24, 29, 39, .32);
  --ky-divider: rgba(40, 50, 72, .1);
  --ky-surface: rgba(255, 255, 255, .7);
  --ky-control-hover: rgba(40, 50, 72, .07);
  --ky-control-border: rgba(40, 50, 72, .28);
}
.kashiyomi-ui * { box-sizing: border-box; }
.kashiyomi-ui .kc-card {
  border: 1px solid var(--ky-divider); border-radius: 9px;
  background: var(--ky-surface); overflow: hidden;
}
.kashiyomi-ui .kc-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 8px 14px; }
.kashiyomi-ui .kc-row + .kc-row { border-top: 1px solid var(--ky-divider); }
.kashiyomi-ui .kc-label { color: var(--ky-text-strong); font-size: 14px; font-weight: 500; line-height: 20px; }
.kashiyomi-ui .kc-desc { color: var(--ky-muted); font-size: 12.5px; margin-top: 1px; line-height: 17px; }
.kashiyomi-ui .kc-inert { opacity: 0.45; cursor: default; }
.kashiyomi-ui .kc-inert .kc-switch { cursor: default; }
.kashiyomi-ui .kui-button {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 0; height: 28px; padding: 0 12px;
  border: 1px solid var(--ky-control-border); border-radius: 14px;
  background: var(--ky-control); color: var(--ky-text-strong);
  font-family: inherit; font-size: 13.5px; line-height: 26px; white-space: nowrap; cursor: pointer;
}
.kashiyomi-ui .kui-button:hover:not(:disabled) { background: var(--ky-control-hover); }
.kashiyomi-ui .kui-button-primary { border-color: var(--ky-accent); background: var(--ky-accent); color: #fff; }
.kashiyomi-ui .kui-button-primary:hover:not(:disabled) { border-color: var(--ky-accent-hover); background: var(--ky-accent-hover); }
.kashiyomi-ui .kui-button-danger { border-color: transparent; color: var(--ky-danger); }
.kashiyomi-ui .kui-button-quiet { border-color: transparent; background: var(--ky-surface); }
.kashiyomi-ui .kui-button:disabled { opacity: .42; cursor: default; }
.kashiyomi-ui .kui-button:focus-visible { outline: 2px solid var(--ky-focus); outline-offset: 2px; }
.kashiyomi-ui .kui-live:empty { display: none; }
.kashiyomi-ui .kui-sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}
`;

/** Put the shared sheet in the document once. */
export function ensureSharedStyles(): void {
  if (document.getElementById("kashiyomi-ui-css")) return;
  const style = document.createElement("style");
  style.id = "kashiyomi-ui-css";
  style.textContent = SHARED_CSS;
  document.head.appendChild(style);
}
