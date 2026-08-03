// Styles for the settings panel only. The lyric-page stylesheet is separate
// and lives in host/styles.ts.

export const PANEL_CSS = `
.kashiyomi-config { display: grid; grid-template-columns: minmax(340px, 1fr) minmax(250px, 0.75fr); gap: 14px; align-items: start; padding: 4px 2px 16px; max-width: 980px; }
.kashiyomi-config * { box-sizing: border-box; }
.kashiyomi-config .kc-full { grid-column: 1 / -1; }
.kashiyomi-config .kc-col { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.kashiyomi-config .kc-status {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 10px 14px; border-radius: 10px;
  background: rgba(255, 255, 255, 0.06); font-size: 13px;
}
.kashiyomi-config .kc-status-right { display: flex; align-items: center; gap: 8px; }
.kashiyomi-config .kc-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; background: #999; }
.kashiyomi-config .kc-ready .kc-dot { background: #52c41a; }
.kashiyomi-config .kc-bad .kc-dot { background: #ff4d4f; }
.kashiyomi-config .kc-loading .kc-dot { background: #faad14; }
.kashiyomi-config .kc-section-title { font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; opacity: 0.55; margin: 2px 2px -6px; }
.kashiyomi-config .kc-card { border-radius: 10px; background: rgba(255, 255, 255, 0.05); overflow: hidden; }
.kashiyomi-config .kc-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 11px 14px; cursor: pointer; }
.kashiyomi-config .kc-row + .kc-row { border-top: 1px solid rgba(255, 255, 255, 0.06); }
.kashiyomi-config .kc-row:hover { background: rgba(255, 255, 255, 0.04); }
.kashiyomi-config .kc-label { font-size: 13.5px; line-height: 1.3; }
.kashiyomi-config .kc-desc { font-size: 12px; opacity: 0.55; margin-top: 2px; line-height: 1.35; }
.kashiyomi-config .kc-switch { position: relative; flex: none; width: 36px; height: 20px; }
.kashiyomi-config .kc-switch input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
.kashiyomi-config .kc-track { position: absolute; inset: 0; border-radius: 999px; background: rgba(255, 255, 255, 0.22); transition: background 0.15s ease; }
.kashiyomi-config .kc-track::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform 0.15s ease; }
.kashiyomi-config .kc-switch input:checked + .kc-track { background: #ec4141; }
.kashiyomi-config .kc-switch input:checked + .kc-track::after { transform: translateX(16px); }
.kashiyomi-config .kc-button { padding: 6px 14px; border: none; border-radius: 8px; background: rgba(255, 255, 255, 0.1); color: inherit; font-size: 12.5px; cursor: pointer; }
.kashiyomi-config .kc-button:hover { background: rgba(255, 255, 255, 0.16); }
.kashiyomi-config .kc-select {
  position: relative; flex: none; display: inline-flex; align-items: center;
}
.kashiyomi-config .kc-select select {
  appearance: none; -webkit-appearance: none;
  padding: 7px 30px 7px 12px; border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px; background: rgba(255, 255, 255, 0.08); color: inherit;
  font-size: 12.5px; font-family: inherit; cursor: pointer; outline: none;
  min-width: 160px;
}
.kashiyomi-config .kc-select select:hover { background: rgba(255, 255, 255, 0.14); }
.kashiyomi-config .kc-select select:focus { border-color: rgba(236, 65, 65, 0.7); }
/* The native popup list is drawn by the OS, so its items only take solid
   colors; keep them readable instead of inheriting the panel's light text. */
.kashiyomi-config .kc-select option { background: #2b2b2b; color: #f2f2f2; }
.kashiyomi-config .kc-select::after {
  content: ""; position: absolute; right: 12px; pointer-events: none;
  width: 6px; height: 6px; border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor; transform: translateY(-2px) rotate(45deg);
  opacity: 0.6;
}
.kashiyomi-config .kc-input {
  padding: 7px 12px; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 8px;
  background: rgba(255, 255, 255, 0.08); color: inherit; font-size: 12.5px;
  font-family: inherit; outline: none;
}
.kashiyomi-config .kc-input:focus { border-color: rgba(236, 65, 65, 0.7); }
.kashiyomi-config input[type="range"] { accent-color: #ec4141; }
.kashiyomi-config .kc-lang { display: flex; border-radius: 8px; overflow: hidden; }
.kashiyomi-config .kc-lang button { padding: 6px 10px; border: none; background: rgba(255, 255, 255, 0.08); color: inherit; font-size: 12px; cursor: pointer; }
.kashiyomi-config .kc-lang button.kc-active { background: #ec4141; }
.kashiyomi-config .kc-preview { padding: 16px 14px 12px; display: flex; flex-direction: column; gap: 14px; }
.kashiyomi-config .kc-preview-line { font-size: 19px; line-height: 1.6; }
.kashiyomi-config .kc-preview-line .kashiyomi-row { opacity: 0.6; }
.kashiyomi-config .kc-about { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; font-size: 12.5px; }
.kashiyomi-config .kc-about .kc-muted { opacity: 0.55; word-break: break-all; }
.kashiyomi-config .kc-link { color: inherit; text-decoration: underline; cursor: pointer; opacity: 0.85; }
`;
