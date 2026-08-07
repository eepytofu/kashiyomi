// Styles for the setup dialog only.
//
// Cards, rows, labels, buttons and status dots come from host/uiStyles.ts,
// which the settings panel injects too. What is left here is what only a modal
// has: the box itself, its backdrop, and the radios.

export const SETUP_CSS = `
.kashiyomi-setup {
  width: min(520px, calc(100vw - 48px));
  max-height: calc(100vh - 96px);
  overflow-y: auto;
  border: none; border-radius: 10px; padding: 20px 22px 16px;
  background: #232323; color: #f2f2f2;
  font-size: 13.5px; line-height: 1.45;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
}
.kashiyomi-setup::backdrop { background: rgba(0, 0, 0, 0.55); }
.kashiyomi-setup .ks-title { font-size: 16px; font-weight: 600; margin-bottom: 10px; }
.kashiyomi-setup .ks-need { opacity: 0.78; margin-bottom: 14px; white-space: pre-line; }
/* The radio sits at the start rather than the far end, which is the one place
   an option row differs from a settings row: a setting has its control on the
   right because the label is the subject, a choice has it on the left because
   the control is what you are pointing at. */
.kashiyomi-setup .ks-option { justify-content: flex-start; align-items: flex-start; gap: 10px; }
/* Drawn by hand rather than with accent-color, which is Chromium 93 and does
   nothing on CEF 91: the radios would have rendered default blue in a dark
   dialog. Same reason the range thumb in the panel sheet is styled through its
   pseudo-element. */
.kashiyomi-setup .ks-option input {
  -webkit-appearance: none; appearance: none;
  flex: none; position: relative; margin: 1px 0 0;
  width: 15px; height: 15px; border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, 0.45); background: transparent;
  cursor: pointer; transition: border-color 0.12s ease;
}
.kashiyomi-setup .ks-option input:checked { border-color: rgb(255, 58, 58); }
.kashiyomi-setup .ks-option input:checked::after {
  content: ""; position: absolute; top: 3px; left: 3px;
  width: 6px; height: 6px; border-radius: 50%; background: rgb(255, 58, 58);
}
.kashiyomi-setup .ks-option-body { min-width: 0; flex: 1; }
/* Which edition is installed, and which one the analyzer actually has open,
   on the option rather than in a sentence under the list. */
.kashiyomi-setup .ks-option-state { flex: none; font-size: 11.5px; opacity: 0.55; white-space: nowrap; }
.kashiyomi-setup .ks-in-use { color: #8fd97a; opacity: 0.9; }
/* No min-height: the row is removed once a download starts, and reserving its
   height left a gap where a line used to be, which reads as something broken.
   Collapsing shrinks the dialog once, at the click that also swaps the button
   to Cancel and the status to progress, so it reads as a response. */
.kashiyomi-setup .ks-space:empty { display: none; }
.kashiyomi-setup .ks-space { font-size: 12px; opacity: 0.68; margin-top: 12px; }
/* Reserves its line whether or not there is anything to say, so starting a
   download does not shift every control below it. */
.kashiyomi-setup .ks-status { font-size: 12.5px; margin-top: 6px; min-height: 18px; }
.kashiyomi-setup .ks-bad { color: #ff8f8f; }
.kashiyomi-setup .ks-ready { color: #8fd97a; }
.kashiyomi-setup .ks-actions { display: flex; align-items: center; gap: 8px; margin-top: 16px; }
.kashiyomi-setup .ks-spacer { flex: 1; }
.kashiyomi-setup .ks-primary { background: rgb(255, 58, 58); }
.kashiyomi-setup .ks-primary:hover:not(:disabled) { background: rgb(255, 90, 90); }
/* CEF 91 has :focus-visible but not :has() or inert, so the ring is the whole
   keyboard affordance here. Buttons get theirs from the shared sheet. */
.kashiyomi-setup input:focus-visible { outline: 2px solid rgba(236, 65, 65, 0.75); outline-offset: 2px; }
`;
