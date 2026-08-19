// The bits of chrome the settings panel and the setup dialog both use.

/** Carried by both roots, and the reason every rule below is scoped to it. */
export const UI_ROOT_CLASS = "kashiyomi-ui";

export const SHARED_CSS = `
.kashiyomi-dictionary-dialog {
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
.kashiyomi-dictionary-dialog.kui-light {
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
  border: 1px solid var(--kc-card-border, transparent); border-radius: 10px;
  background: var(--kc-card-bg, rgba(255, 255, 255, 0.05)); overflow: hidden;
}
.kashiyomi-ui .kc-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 11px 14px; }
.kashiyomi-ui .kc-row + .kc-row { border-top: 1px solid var(--kc-divider, rgba(255, 255, 255, 0.06)); }
.kashiyomi-ui .kc-label { font-size: 13.5px; font-weight: 500; line-height: 1.3; }
.kashiyomi-ui .kc-desc { font-size: 12px; opacity: 0.68; margin-top: 2px; line-height: 1.35; }
.kashiyomi-ui .kc-inert { opacity: 0.45; cursor: default; }
.kashiyomi-ui .kc-inert .kc-switch { cursor: default; }
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
