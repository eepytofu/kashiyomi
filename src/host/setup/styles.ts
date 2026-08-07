// Styles for the setup dialog only.
//
// Self-contained rather than reusing the panel's sheet: the dialog also opens on
// first run, with no settings panel in the document to have injected it. The two
// `kc-button` rules it does borrow are re-declared here for that reason.

export const SETUP_CSS = `
.kashiyomi-setup {
  width: min(520px, calc(100vw - 48px));
  max-height: calc(100vh - 96px);
  overflow-y: auto;
  border: none; border-radius: 14px; padding: 22px 24px 18px;
  background: #232323; color: #f2f2f2;
  font-size: 13.5px; line-height: 1.45;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
}
.kashiyomi-setup::backdrop { background: rgba(0, 0, 0, 0.55); }
.kashiyomi-setup * { box-sizing: border-box; }
.kashiyomi-setup .ks-title { font-size: 16px; font-weight: 600; margin-bottom: 10px; }
.kashiyomi-setup .ks-intro { opacity: 0.78; margin-bottom: 12px; white-space: pre-line; }
.kashiyomi-setup .ks-need { opacity: 0.78; margin-bottom: 14px; }
.kashiyomi-setup .ks-list { display: flex; flex-direction: column; gap: 8px; }
/* The row is the click target, so the whole thing highlights rather than just
   the radio. align-items:start keeps the control on the first line when the
   description wraps to two. */
.kashiyomi-setup .ks-option {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 10px 12px; border-radius: 10px; cursor: pointer;
  background: rgba(255, 255, 255, 0.05);
}
.kashiyomi-setup .ks-option:hover { background: rgba(255, 255, 255, 0.09); }
/* Drawn by hand rather than with accent-color, which is Chrome 93+ and does
   nothing on CEF 91: the radios would have rendered default blue in a dark
   dialog. Same reason the range thumb in the panel sheet is styled through its
   pseudo-element. */
.kashiyomi-setup .ks-option input {
  -webkit-appearance: none; appearance: none;
  flex: none; position: relative; margin: 2px 0 0;
  width: 15px; height: 15px; border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, 0.45); background: transparent;
  cursor: pointer; transition: border-color 0.12s ease;
}
.kashiyomi-setup .ks-option input:checked { border-color: #ec4141; }
.kashiyomi-setup .ks-option input:checked::after {
  content: ""; position: absolute; top: 3px; left: 3px;
  width: 6px; height: 6px; border-radius: 50%; background: #ec4141;
}
.kashiyomi-setup .ks-disabled { opacity: 0.5; cursor: default; }
.kashiyomi-setup .ks-option-body { min-width: 0; }
.kashiyomi-setup .ks-option-head { font-weight: 500; }
.kashiyomi-setup .ks-option-note { font-size: 12px; opacity: 0.68; margin-top: 2px; }
.kashiyomi-setup .ks-space { font-size: 12px; opacity: 0.68; margin-top: 12px; min-height: 17px; }
/* Reserves its line whether or not there is anything to say, so starting a
   download does not shift every control below it. */
.kashiyomi-setup .ks-status { font-size: 12.5px; margin-top: 6px; min-height: 18px; }
.kashiyomi-setup .ks-bad { color: #ff8f8f; }
.kashiyomi-setup .ks-ready { color: #8fd97a; }
.kashiyomi-setup .ks-actions { display: flex; align-items: center; gap: 8px; margin-top: 16px; }
.kashiyomi-setup .ks-spacer { flex: 1; }
.kashiyomi-setup .kc-button {
  padding: 7px 14px; border: none; border-radius: 8px;
  background: rgba(255, 255, 255, 0.1); color: inherit;
  font-size: 12.5px; font-family: inherit; cursor: pointer;
}
.kashiyomi-setup .kc-button:hover:not(:disabled) { background: rgba(255, 255, 255, 0.18); }
.kashiyomi-setup .kc-button:disabled { opacity: 0.5; cursor: default; }
.kashiyomi-setup .ks-primary { background: #ec4141; }
.kashiyomi-setup .ks-primary:hover:not(:disabled) { background: #f25555; }
/* CEF 91 has :focus-visible but not :has() or inert, so the ring is the whole
   keyboard affordance here. */
.kashiyomi-setup .kc-button:focus-visible,
.kashiyomi-setup input:focus-visible { outline: 2px solid rgba(236, 65, 65, 0.75); outline-offset: 2px; }
`;
