// Styles for the settings panel only. Shared tokens and controls live in uiStyles.ts.

export const PANEL_CSS = `
.kashiyomi-config {
  display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0;
  padding: 0 2px; max-width: 980px;
}
.kashiyomi-config .kc-scroll {
  display: grid; grid-template-columns: minmax(340px, 1fr) minmax(250px, .78fr);
  gap: 16px; align-items: start; min-height: 0; overflow-y: auto; padding-bottom: 16px;
}
.kashiyomi-config .kc-col { display: flex; flex-direction: column; gap: 13px; min-width: 0; }
.kashiyomi-config .kc-col-side { position: sticky; top: 0; align-self: start; }
.kashiyomi-config .kc-tabs {
  display: flex; flex: none; flex-wrap: wrap; align-items: center;
  justify-content: space-between; gap: 6px 16px; margin-bottom: 6px;
}
.kashiyomi-config .kc-tablist {
  display: flex; flex: 1 1 420px; align-items: center; gap: 20px; min-width: 0; flex-wrap: wrap;
}
.kashiyomi-config .kc-tab {
  appearance: none; -webkit-appearance: none; background: none; border: none;
  position: relative; padding: 4px 0; margin: 0; cursor: pointer;
  color: var(--ky-text-strong); opacity: .58; font-family: inherit;
  font-size: 16px; line-height: 22px; font-weight: 600;
  transition: opacity .12s ease;
}
.kashiyomi-config .kc-tab:hover { opacity: .82; }
.kashiyomi-config .kc-tab-on { opacity: 1; }
.kashiyomi-config .kc-tab-on::after {
  content: ""; position: absolute; left: 0; right: 0; bottom: -1px;
  height: 3px; border-radius: 3px; background: var(--ky-accent);
}
.kashiyomi-config .kc-tab:focus-visible { outline: 2px solid var(--ky-focus); outline-offset: 2px; }
.kashiyomi-config .kc-status-right {
  display: flex; flex: none; align-items: center; gap: 10px; margin-left: auto;
}
.kashiyomi-config .kc-section-title {
  color: var(--ky-muted); font-size: 12px; font-weight: 600; line-height: 16px;
  letter-spacing: .04em; text-transform: uppercase; margin: 1px 2px -5px;
}
.kashiyomi-config [data-kc-anchor] { scroll-margin-top: 8px; }
.kashiyomi-config .kc-needs-dict { padding: 7px 14px; color: var(--ky-muted); font-size: 12px; }
.kashiyomi-config .kc-switch {
  position: relative; flex: none; display: grid; place-items: center;
  width: 28px; height: 28px; cursor: pointer;
}
.kashiyomi-config .kc-switch input {
  position: absolute; inset: 0; width: 28px; height: 28px; margin: 0; opacity: 0; cursor: pointer;
}
.kashiyomi-config .kc-track {
  position: relative; width: 16px; height: 16px; border-radius: 4px;
  border: 1px solid var(--ky-faint); background: transparent;
  transition: border-color .12s ease, background .12s ease;
}
.kashiyomi-config .kc-track::after {
  content: ""; position: absolute; left: 4px; top: 2px; width: 5px; height: 8px;
  border-right: 1.5px solid #fff; border-bottom: 1.5px solid #fff;
  opacity: 0; transform: rotate(45deg);
}
.kashiyomi-config .kc-switch input:checked + .kc-track {
  border-color: var(--ky-accent); background: var(--ky-accent);
}
.kashiyomi-config .kc-switch input:checked + .kc-track::after { opacity: 1; }
.kashiyomi-config .kc-switch input:focus-visible + .kc-track { box-shadow: 0 0 0 2px var(--ky-focus); }
.kashiyomi-config .kc-switch input:disabled, .kashiyomi-config .kc-switch input:disabled + .kc-track { cursor: default; }
.kashiyomi-config .kc-select { position: relative; flex: none; display: inline-flex; align-items: center; }
.kashiyomi-config .kc-select-trigger {
  appearance: none; -webkit-appearance: none; height: 28px;
  padding: 0 30px 0 12px; border: 1px solid var(--ky-control-border);
  border-radius: 14px; background: transparent; color: var(--ky-text-strong);
  font-family: inherit; font-size: 13.5px; line-height: 26px; cursor: pointer; outline: none;
  min-width: 160px; text-align: left;
}
.kashiyomi-config .kc-select-trigger:hover { background: var(--ky-control-hover); }
.kashiyomi-config .kc-select-trigger:focus-visible { outline: 2px solid var(--ky-focus); outline-offset: 2px; }
.kashiyomi-config .kc-select-text { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kashiyomi-config .kc-menu {
  position: fixed; z-index: 20; box-sizing: border-box;
  max-height: 260px; overflow-y: auto; padding: 4px 0;
  border: 1px solid var(--ky-control-border); border-radius: 8px;
  background: var(--ky-dialog-bg); color: var(--ky-text-strong);
  box-shadow: 0 8px 22px rgba(0, 0, 0, .36);
}
.kashiyomi-config .kc-menu[hidden] { display: none; }
.kashiyomi-config .kc-menu-item {
  margin: 2px 5px; padding: 6px 8px; border-radius: 5px;
  font-size: 13px; line-height: 17px; cursor: pointer;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.kashiyomi-config .kc-menu-on { background: var(--ky-control-hover); }
.kashiyomi-config .kc-menu-current { color: var(--ky-accent); }
.kashiyomi-config .kc-select::after {
  content: ""; position: absolute; right: 12px; pointer-events: none;
  width: 6px; height: 6px; border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  top: 50%; transform: translateY(-60%) rotate(45deg); opacity: .58;
}
.kashiyomi-config .kc-input {
  min-height: 30px; padding: 5px 10px; border: 1px solid var(--ky-control-border);
  border-radius: 7px; background: transparent; color: var(--ky-text-strong);
  font-family: inherit; font-size: 13px; line-height: 18px; outline: none;
}
.kashiyomi-config .kc-input:focus { border-color: var(--ky-accent); box-shadow: 0 0 0 1px var(--ky-accent); }
.kashiyomi-config input[type="range"] {
  -webkit-appearance: none; appearance: none; width: 160px;
  height: 3px; border-radius: 999px; outline: none; background: var(--ky-faint);
}
.kashiyomi-config input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 13px; height: 13px; border-radius: 50%; border: none;
  background: var(--ky-accent); cursor: pointer;
}
.kashiyomi-config input[type="range"]:focus-visible { box-shadow: 0 0 0 2px var(--ky-focus); }
.kashiyomi-config .kc-lang {
  display: flex; height: 28px; border-radius: 14px; overflow: hidden;
  border: 1px solid var(--ky-control-border);
}
.kashiyomi-config .kc-lang button {
  min-width: 34px; padding: 0 10px; border: none; background: transparent;
  color: var(--ky-text-strong); font-family: inherit; font-size: 13px; line-height: 26px; cursor: pointer;
}
.kashiyomi-config .kc-lang button:hover:not(.kc-active) { background: var(--ky-control-hover); }
.kashiyomi-config .kc-lang button.kc-active { background: var(--ky-accent); color: #fff; }
.kashiyomi-config .kc-lang button:focus-visible { outline: 2px solid var(--ky-focus); outline-offset: -2px; }
.kashiyomi-config .kc-preview { padding: 14px 14px 12px; display: flex; flex-direction: column; gap: 12px; }
.kashiyomi-config .kc-preview-line { font-size: 19px; line-height: 1.55; }
.kashiyomi-config .kc-about { padding: 11px 14px; display: flex; flex-direction: column; align-items: flex-start; gap: 7px; font-size: 13px; }
.kashiyomi-config .kc-about .kc-muted { color: var(--ky-muted); word-break: break-all; }
.kashiyomi-config .kc-link {
  appearance: none; -webkit-appearance: none; border: 0; padding: 0; margin: 0;
  background: none; color: var(--ky-text); font: inherit; text-decoration: underline;
  cursor: pointer; text-align: left;
}
.kashiyomi-config .kc-link:hover { color: var(--ky-text-strong); }
.kashiyomi-config .kc-link:focus-visible { outline: 2px solid var(--ky-focus); outline-offset: 2px; }
@media (max-width: 1100px) {
  .kashiyomi-config .kc-scroll { grid-template-columns: minmax(0, 1fr); }
  .kashiyomi-config .kc-col-side { position: static; }
  .kashiyomi-config .kc-tablist { gap: 14px; }
}
`;
