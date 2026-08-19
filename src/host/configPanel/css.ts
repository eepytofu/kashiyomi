// Styles for the settings panel only.

export const PANEL_CSS = `
.kashiyomi-config {
  --kc-card-bg: rgba(255, 255, 255, 0.05);
  --kc-card-border: transparent;
  --kc-divider: rgba(255, 255, 255, 0.06);
  --kc-control-bg: rgba(255, 255, 255, 0.08);
  --kc-control-hover: rgba(255, 255, 255, 0.14);
  --kc-control-border: rgba(255, 255, 255, 0.12);
  --kc-button-bg: rgba(255, 255, 255, 0.1);
  --kc-button-hover: rgba(255, 255, 255, 0.16);
  --kc-menu-bg: #1c1c24;
  --kc-menu-highlight: rgba(255, 255, 255, 0.1);
  --kc-menu-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
  --kc-switch-outline: rgba(255, 255, 255, 0.38);
  --kc-switch-knob: #fff;
  --kc-range-track: rgba(255, 255, 255, 0.22);
  display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0;
  padding: 0 2px; max-width: 980px;
}
.kashiyomi-config.kc-theme-light {
  --kc-card-bg: rgba(255, 255, 255, 0.72);
  --kc-card-border: rgba(40, 50, 72, 0.12);
  --kc-divider: rgba(40, 50, 72, 0.1);
  --kc-control-bg: rgba(255, 255, 255, 0.82);
  --kc-control-hover: #fff;
  --kc-control-border: rgba(40, 50, 72, 0.22);
  --kc-button-bg: rgba(40, 50, 72, 0.08);
  --kc-button-hover: rgba(40, 50, 72, 0.14);
  --kc-menu-bg: #fff;
  --kc-menu-highlight: rgba(40, 50, 72, 0.1);
  --kc-menu-shadow: 0 6px 16px rgba(40, 50, 72, 0.22);
  --kc-switch-outline: rgba(40, 50, 72, 0.42);
  --kc-switch-knob: rgba(40, 50, 72, 0.62);
  --kc-range-track: rgba(40, 50, 72, 0.24);
}
.kashiyomi-config .kc-scroll {
  display: grid; grid-template-columns: minmax(340px, 1fr) minmax(250px, 0.75fr);
  gap: 14px; align-items: start; min-height: 0; overflow-y: auto; padding-bottom: 16px;
}
.kashiyomi-config .kc-col { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
/* The side column stays within the plugin-owned scroll area. */
.kashiyomi-config .kc-col-side { position: sticky; top: 0; align-self: start; }
/* NCM's own settings strip: tabs left, underline on the active one, in its red.
   Not a card and not a pill row — flat, with a hairline under the whole strip,
   rather than as a control this plugin invented. */
.kashiyomi-config .kc-tabs {
  display: flex; flex: none; flex-wrap: wrap; align-items: flex-end;
  justify-content: space-between; gap: 8px 16px; margin-bottom: 6px;
}
.kashiyomi-config .kc-tablist { display: flex; flex: 1 1 420px; align-items: flex-end; gap: 22px; min-width: 0; flex-wrap: wrap; }
/* Measured off cmd-anchor-link-title: 16px, weight 600 in BOTH states, and only
   the colour changes. A weight change would reflow the strip on every scroll,
   which is the whole reason NCM does not do it. */
.kashiyomi-config .kc-tab {
  appearance: none; -webkit-appearance: none; background: none; border: none;
  position: relative; padding: 6px 0 10px; margin: 0; cursor: pointer;
  color: inherit; opacity: 0.6; font-family: inherit;
  font-size: 15px; font-weight: 600;
  transition: opacity 0.12s ease;
}
.kashiyomi-config .kc-tab:hover { opacity: 0.85; }
.kashiyomi-config .kc-tab-on { opacity: 1; }
/* A rounded 3px bar, not a square border-bottom, in NCM's own red. Measured off
   the host's active tab indicator: #ff3a3a, not the #ec4141 this plugin used
   off beside a real NCM control. */
.kashiyomi-config .kc-tab-on::after {
  content: ""; position: absolute; left: 0; right: 0; bottom: 2px;
  height: 3px; border-radius: 20px; background: rgb(255, 58, 58);
}
.kashiyomi-config .kc-tab:focus-visible { outline: 2px solid rgba(255, 58, 58, 0.75); outline-offset: 2px; }
.kashiyomi-config .kc-status-right { display: flex; flex: none; align-items: center; gap: 14px; padding-bottom: 6px; margin-left: auto; }
.kashiyomi-config .kc-section-title { font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; opacity: 0.68; margin: 2px 2px -6px; }
.kashiyomi-config [data-kc-anchor] { scroll-margin-top: 8px; }
.kashiyomi-config .kc-needs-dict { padding: 9px 14px; font-size: 12px; opacity: 0.68; }
.kashiyomi-config .kc-switch { position: relative; flex: none; width: 40px; height: 24px; cursor: pointer; }
.kashiyomi-config .kc-switch input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
/* Off is a hollow outlined track, on is filled — so the state is legible from
   the shape alone and does not depend on seeing the red. An inset shadow rather
   gaps back onto half pixels. */
.kashiyomi-config .kc-track {
  position: absolute; inset: 0; border-radius: 999px;
  background: transparent; box-shadow: inset 0 0 0 2px var(--kc-switch-outline);
  transition: background 0.15s ease, box-shadow 0.15s ease;
}
.kashiyomi-config .kc-track::after { content: ""; position: absolute; top: 4px; left: 4px; width: 16px; height: 16px; border-radius: 50%; background: var(--kc-switch-knob); transition: transform 0.15s ease; }
.kashiyomi-config .kc-switch input:checked + .kc-track { background: rgb(255, 58, 58); box-shadow: none; }
.kashiyomi-config .kc-switch input:checked + .kc-track::after { background: #fff; }
/* The real checkbox is opacity:0, so without this a keyboard user tabbing
   through twelve switches gets no indication of where they are. The unchecked
   rule keeps the outline, which is the same shadow property. */
.kashiyomi-config .kc-switch input:focus-visible + .kc-track {
  box-shadow: inset 0 0 0 2px var(--kc-switch-outline), 0 0 0 2px rgba(255, 58, 58, 0.75);
}
.kashiyomi-config .kc-switch input:checked:focus-visible + .kc-track { box-shadow: 0 0 0 2px rgba(255, 58, 58, 0.75); }
.kashiyomi-config .kc-switch input:checked + .kc-track::after { transform: translateX(16px); }
.kashiyomi-config .kc-select {
  position: relative; flex: none; display: inline-flex; align-items: center;
}
/* Same box the native select had, so nothing moves: only what happens when it
   opens has changed. */
.kashiyomi-config .kc-select-trigger {
  appearance: none; -webkit-appearance: none;
  padding: 7px 30px 7px 12px; border: 1px solid var(--kc-control-border);
  border-radius: 8px; background: var(--kc-control-bg); color: inherit;
  font-size: 12.5px; font-family: inherit; cursor: pointer; outline: none;
  min-width: 160px; text-align: left;
}
.kashiyomi-config .kc-select-trigger:hover { background: var(--kc-control-hover); }
.kashiyomi-config .kc-select-trigger:focus-visible { border-color: rgba(255, 58, 58, 0.7); }
/* One line, clipped with an ellipsis rather than wrapping the row: a target
   language can be longer than the control. */
.kashiyomi-config .kc-select-text { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Fixed, because six ancestors clip and the nearest is our own .kc-card. Placed
   from the trigger's rect in dropdown.ts; only the look lives here. */
.kashiyomi-config .kc-menu {
  position: fixed; z-index: 20; box-sizing: border-box;
  max-height: 260px; overflow-y: auto; padding: 4px 0;
  border: 1px solid var(--kc-control-border); border-radius: 8px;
  background: var(--kc-menu-bg);
  box-shadow: var(--kc-menu-shadow);
}
.kashiyomi-config .kc-menu[hidden] { display: none; }
.kashiyomi-config .kc-menu-item {
  margin: 2px 6px; padding: 6px 8px; border-radius: 4px;
  font-size: 12.5px; line-height: 1.35; cursor: pointer;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* The keyboard highlight and the current value are different things and have to
   look different: arrowing through the list must not make it look as though the
   setting has already changed. */
.kashiyomi-config .kc-menu-on { background: var(--kc-menu-highlight); }
.kashiyomi-config .kc-menu-current { color: rgb(255, 58, 58); }
.kashiyomi-config .kc-select::after {
  content: ""; position: absolute; right: 12px; pointer-events: none;
  width: 6px; height: 6px; border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  /* Anchored to the box centre rather than left to its static position, which
     put it ~3px high. The extra -10% offsets the chevron's visual mass, which
     sits below the square's centre once rotated. */
  top: 50%; transform: translateY(-60%) rotate(45deg);
  opacity: 0.6;
}
.kashiyomi-config .kc-input {
  padding: 7px 12px; border: 1px solid var(--kc-control-border); border-radius: 8px;
  background: var(--kc-control-bg); color: inherit; font-size: 12.5px;
  font-family: inherit; outline: none;
}
.kashiyomi-config .kc-input:focus { border-color: rgba(255, 58, 58, 0.7); }
/* accent-color is Chrome 93+ and this runs on CEF 91, where it silently does
   nothing and the slider renders in the default blue. Style the pseudo-elements
   instead — those Chrome has had since long before 91. */
.kashiyomi-config input[type="range"] {
  -webkit-appearance: none; appearance: none;
  height: 4px; border-radius: 999px; outline: none;
  background: var(--kc-range-track);
}
.kashiyomi-config input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 14px; height: 14px; border-radius: 50%; border: none;
  background: rgb(255, 58, 58); cursor: pointer;
}
.kashiyomi-config input[type="range"]:focus-visible { box-shadow: 0 0 0 2px rgba(255, 58, 58, 0.45); }
.kashiyomi-config .kc-lang { display: flex; border-radius: 8px; overflow: hidden; box-shadow: inset 0 0 0 1px var(--kc-control-border); }
.kashiyomi-config .kc-lang button { padding: 6px 10px; border: none; background: transparent; color: inherit; font-size: 12px; cursor: pointer; }
.kashiyomi-config .kc-lang button:hover:not(.kc-active) { background: var(--kc-button-bg); }
.kashiyomi-config .kc-lang button.kc-active { background: rgb(255, 58, 58); }
/* The switches got a focus ring earlier; these are the remaining tab stops. */
.kashiyomi-config .kc-button:focus-visible,
.kashiyomi-config .kc-lang button:focus-visible { outline: 2px solid rgba(255, 58, 58, 0.75); outline-offset: 2px; }
.kashiyomi-config .kc-preview { padding: 16px 14px 12px; display: flex; flex-direction: column; gap: 14px; }
.kashiyomi-config .kc-preview-line { font-size: 19px; line-height: 1.6; }
.kashiyomi-config .kc-about { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; font-size: 12.5px; }
.kashiyomi-config .kc-about .kc-muted { opacity: 0.68; word-break: break-all; }
.kashiyomi-config .kc-link { color: inherit; text-decoration: underline; cursor: pointer; opacity: 0.85; }
@media (max-width: 1100px) {
  .kashiyomi-config .kc-scroll { grid-template-columns: minmax(0, 1fr); }
  .kashiyomi-config .kc-col-side { position: static; }
  .kashiyomi-config .kc-tablist { gap: 14px; }
}
`;
