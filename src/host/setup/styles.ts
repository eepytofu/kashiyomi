// Dictionary dialog: compact NCM geometry, semantic host-derived surfaces.

export const SETUP_CSS = `
.kashiyomi-dictionary-dialog {
  width: min(480px, calc(100vw - 32px)); max-height: calc(100vh - 48px);
  margin: auto; overflow: auto; border: 1px solid var(--ky-divider); border-radius: 11px; padding: 18px 20px 20px;
  background: var(--ky-dialog-bg); color: var(--ky-text); font-family: inherit; font-size: 13.5px; line-height: 1.45;
  box-shadow: 0 18px 54px rgba(0, 0, 0, .38);
}
.kashiyomi-dictionary-dialog::backdrop { background: rgba(0, 0, 0, .54); }
.kashiyomi-dictionary-dialog [hidden] { display: none !important; }
.kashiyomi-dictionary-dialog .kd-header { display: flex; align-items: center; min-height: 28px; gap: 12px; }
.kashiyomi-dictionary-dialog .kd-title {
  flex: 1; margin: 0; color: var(--ky-text-strong); font-size: 16px; line-height: 22px; font-weight: 600;
}
.kashiyomi-dictionary-dialog .kd-header-close {
  width: 28px; padding: 0; border-color: transparent; background: transparent; font-size: 20px; font-weight: 300;
}
.kashiyomi-dictionary-dialog .kd-intro { margin: 6px 0 8px; color: var(--ky-muted); }
.kashiyomi-dictionary-dialog .kd-list { min-width: 0; margin: 4px 0 0; padding: 0; border: 0; }
.kashiyomi-dictionary-dialog .kd-edition {
  display: grid; grid-template-columns: minmax(0, 1fr) minmax(150px, auto); gap: 10px 14px;
  align-items: center; padding: 12px 0; border-top: 1px solid var(--ky-divider);
}
.kashiyomi-dictionary-dialog .kd-edition:first-of-type { border-top: 0; }
.kashiyomi-dictionary-dialog .kd-choice { display: flex; min-width: 0; gap: 10px; align-items: flex-start; }
.kashiyomi-dictionary-dialog .kd-selectable .kd-choice { cursor: pointer; }
.kashiyomi-dictionary-dialog .kd-choice input {
  -webkit-appearance: none; appearance: none; position: relative; flex: 0 0 auto;
  width: 16px; height: 16px; margin: 2px 0 0; border: 1.5px solid var(--ky-faint);
  border-radius: 50%; background: transparent;
}
.kashiyomi-dictionary-dialog .kd-choice input:checked { border-color: var(--ky-accent); }
.kashiyomi-dictionary-dialog .kd-choice input:checked::after {
  content: ""; position: absolute; inset: 3px; border-radius: 50%; background: var(--ky-accent);
}
.kashiyomi-dictionary-dialog .kd-details, .kashiyomi-dictionary-dialog .kd-name,
.kashiyomi-dictionary-dialog .kd-desc, .kashiyomi-dictionary-dialog .kd-size { display: block; }
.kashiyomi-dictionary-dialog .kd-name { color: var(--ky-text-strong); font-size: 14px; line-height: 20px; font-weight: 600; }
.kashiyomi-dictionary-dialog .kd-desc { margin-top: 1px; color: var(--ky-muted); font-size: 12.5px; line-height: 17px; }
.kashiyomi-dictionary-dialog .kd-size { margin-top: 3px; color: var(--ky-faint); font-size: 12px; line-height: 17px; }
.kashiyomi-dictionary-dialog .kd-side { display: flex; flex-direction: column; align-items: flex-end; gap: 7px; }
.kashiyomi-dictionary-dialog .kd-state { color: var(--ky-muted); font-size: 12px; line-height: 17px; white-space: nowrap; }
.kashiyomi-dictionary-dialog .kd-state-active { color: var(--ky-accent); }
.kashiyomi-dictionary-dialog .kd-row-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.kashiyomi-dictionary-dialog .kd-confirm { padding: 14px 0 2px; }
.kashiyomi-dictionary-dialog .kd-confirm p { margin: 0; }
.kashiyomi-dictionary-dialog .kd-confirm-summary { color: var(--ky-text-strong); font-weight: 500; }
.kashiyomi-dictionary-dialog .kd-help { margin-top: 6px !important; color: var(--ky-muted); }
.kashiyomi-dictionary-dialog .kd-progress { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--ky-divider); }
.kashiyomi-dictionary-dialog .kd-progress-heading { color: var(--ky-text-strong); font-weight: 500; }
.kashiyomi-dictionary-dialog .kd-progress-head { display: flex; justify-content: space-between; gap: 16px; margin-top: 5px; color: var(--ky-muted); font-size: 12px; }
.kashiyomi-dictionary-dialog .kd-track { height: 3px; margin-top: 7px; overflow: hidden; border-radius: 2px; background: var(--ky-divider); }
.kashiyomi-dictionary-dialog .kd-bar { height: 100%; min-width: 3px; background: var(--ky-accent); transition: width .18s linear; }
.kashiyomi-dictionary-dialog .kd-bar-indeterminate { animation: kd-progress 1.2s ease-in-out infinite alternate; }
.kashiyomi-dictionary-dialog .kd-feedback { margin-top: 10px; color: var(--ky-muted); }
.kashiyomi-dictionary-dialog .kd-feedback-error { color: var(--ky-danger); }
.kashiyomi-dictionary-dialog .kd-footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.kashiyomi-dictionary-dialog .kd-footer-action { height: 32px; padding: 0 16px; border-radius: 16px; }
.kashiyomi-dictionary-dialog button:focus-visible,
.kashiyomi-dictionary-dialog input:focus-visible { outline: 2px solid var(--ky-focus); outline-offset: 2px; }
@keyframes kd-progress { from { transform: translateX(0); } to { transform: translateX(450%); } }
@media (max-width: 520px) {
  .kashiyomi-dictionary-dialog { width: calc(100vw - 20px); padding: 16px; }
  .kashiyomi-dictionary-dialog .kd-edition { grid-template-columns: minmax(0, 1fr); gap: 7px; }
  .kashiyomi-dictionary-dialog .kd-side { flex-direction: row; align-items: center; justify-content: space-between; }
  .kashiyomi-dictionary-dialog .kd-row-actions { margin-left: auto; }
}
@media (prefers-reduced-motion: reduce) {
  .kashiyomi-dictionary-dialog .kd-bar { transition: none; animation: none; }
}
`;
