// Dictionary dialog aligned with NCM's own color tokens and pill controls.

export const SETUP_CSS = `
.kashiyomi-dictionary-dialog {
  width: min(520px, calc(100vw - 32px)); max-height: calc(100vh - 64px);
  margin: auto; overflow: auto; border: 0; border-radius: 12px; padding: 24px;
  background: var(--colorFunction4); color: var(--colorBlack3);
  font: 14px/1.45 inherit; box-shadow: 0 18px 54px rgba(0, 0, 0, .38);
}
.kashiyomi-dictionary-dialog::backdrop { background: rgba(0, 0, 0, .55); }
.kashiyomi-dictionary-dialog .kd-title { margin: 0; font-size: 18px; line-height: 1.35; font-weight: 600; }
.kashiyomi-dictionary-dialog .kd-intro { margin: 8px 0 14px; opacity: .68; }
.kashiyomi-dictionary-dialog .kd-list { margin-top: 12px; }
.kashiyomi-dictionary-dialog .kd-edition {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 14px;
  padding: 15px 0; border-top: 1px solid var(--colorBlack11);
}
.kashiyomi-dictionary-dialog .kd-edition:first-child { border-top: 0; }
.kashiyomi-dictionary-dialog .kd-choice { display: flex; min-width: 0; gap: 12px; align-items: flex-start; cursor: pointer; }
.kashiyomi-dictionary-dialog .kd-choice input {
  -webkit-appearance: none; appearance: none; position: relative; flex: 0 0 auto;
  width: 18px; height: 18px; margin: 2px 0 0; border: 1.5px solid currentColor;
  border-radius: 50%; opacity: .55; background: transparent;
}
.kashiyomi-dictionary-dialog .kd-choice input:checked { border-color: rgb(255, 58, 58); opacity: 1; }
.kashiyomi-dictionary-dialog .kd-choice input:checked::after {
  content: ""; position: absolute; inset: 4px; border-radius: 50%; background: rgb(255, 58, 58);
}
.kashiyomi-dictionary-dialog .kd-name { font-size: 15px; font-weight: 600; }
.kashiyomi-dictionary-dialog .kd-desc, .kashiyomi-dictionary-dialog .kd-size,
.kashiyomi-dictionary-dialog .kd-help { opacity: .68; }
.kashiyomi-dictionary-dialog .kd-size { margin-top: 4px; font-size: 12px; }
.kashiyomi-dictionary-dialog .kd-state { align-self: start; white-space: nowrap; font-size: 12px; opacity: .68; }
.kashiyomi-dictionary-dialog .kd-state-active { color: rgb(255, 58, 58); opacity: 1; }
.kashiyomi-dictionary-dialog .kd-row-actions { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 8px; }
.kashiyomi-dictionary-dialog .kd-button {
  min-width: 0; height: 28px; padding: 0 14px; border: 0; border-radius: 14px;
  background: var(--colorBlack11); color: var(--colorBlack2); font: 13px/28px inherit; cursor: pointer;
}
.kashiyomi-dictionary-dialog .kd-button:hover:not(:disabled) { background: var(--colorBlack10); color: var(--colorBlack1); }
.kashiyomi-dictionary-dialog .kd-button:disabled { opacity: .42; cursor: default; }
.kashiyomi-dictionary-dialog .kd-primary { background: rgb(255, 58, 58); color: white; }
.kashiyomi-dictionary-dialog .kd-primary:hover:not(:disabled) { background: rgb(255, 78, 78); }
.kashiyomi-dictionary-dialog .kd-danger { color: var(--colorFunction1); }
.kashiyomi-dictionary-dialog .kd-large { height: 40px; padding: 0 20px; border-radius: 20px; font-size: 14px; line-height: 40px; }
.kashiyomi-dictionary-dialog .kd-actions { display: flex; align-items: center; gap: 8px; margin-top: 18px; }
.kashiyomi-dictionary-dialog .kd-actions .kd-close { margin-left: auto; }
.kashiyomi-dictionary-dialog .kd-progress { margin-top: 18px; }
.kashiyomi-dictionary-dialog .kd-progress-head { display: flex; justify-content: space-between; gap: 16px; }
.kashiyomi-dictionary-dialog .kd-track { height: 3px; margin-top: 10px; overflow: hidden; border-radius: 2px; background: var(--colorBlack10); }
.kashiyomi-dictionary-dialog .kd-bar { height: 100%; min-width: 4px; background: rgb(255, 58, 58); transition: width .18s linear; }
.kashiyomi-dictionary-dialog .kd-error { margin-top: 14px; color: var(--colorFunction1); }
.kashiyomi-dictionary-dialog .kd-confirm { margin-top: 18px; }
.kashiyomi-dictionary-dialog button:focus-visible,
.kashiyomi-dictionary-dialog input:focus-visible { outline: 2px solid rgb(255, 58, 58); outline-offset: 2px; }
@media (max-width: 560px) {
  .kashiyomi-dictionary-dialog { width: calc(100vw - 20px); padding: 20px; }
  .kashiyomi-dictionary-dialog .kd-edition { grid-template-columns: minmax(0, 1fr); }
  .kashiyomi-dictionary-dialog .kd-state { grid-row: 1; justify-self: end; }
  .kashiyomi-dictionary-dialog .kd-choice { padding-right: 80px; grid-row: 1 / span 2; }
}
`;
