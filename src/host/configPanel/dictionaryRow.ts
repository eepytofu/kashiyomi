// The dictionary's line in the settings panel: what is installed, and a way in.
//
// Everything else moved into the setup dialog. The row used to carry the
// edition picker, a description of the selected edition, an action button and a
// cancel button, which made it three times the height of its neighbours and
// crushed its own label at any narrow window: measured at 1536px, the note left
// the label 67px and wrapped "Japanese dictionary" over three lines.
//
// The dialog was needed anyway for first run, so keeping a second copy of the
// same choice here would have been two surfaces showing the same three editions
// and drifting apart. One surface, one entry point.

import { t } from "../i18n.ts";
import { dictionaryInventory, dictionaryJob, onDictionaryChange } from "../dictionary.ts";
import { dictionaryRowState, type RowDot } from "../../engine/dictionaryRowState.ts";
import { describe } from "../dictionaryText.ts";
import { openDictionarySetup } from "../setup/dialog.ts";
import { getSettings } from "../settings.ts";
import { onPanelTeardown } from "./lifecycle.ts";
import { row, rowText } from "./rows.ts";

const DOT_CLASS: Record<RowDot, string> = {
  ready: "kc-ready",
  loading: "kc-loading",
  bad: "kc-bad",
  neutral: "",
};

export function dictionaryRow(): HTMLElement {
  const el = row();
  const text = rowText(t("dictionary"), t("dictNotInstalled"));
  const description = text.querySelector(".kc-desc") ?? text.lastElementChild;
  const dot = document.createElement("span");
  dot.className = "kc-dot";
  text.querySelector(".kc-label")?.prepend(dot);
  el.appendChild(text);

  const manage = document.createElement("button");
  manage.className = "kc-button";
  manage.onclick = () => openDictionarySetup();
  el.appendChild(manage);

  const paint = (): void => {
    const view = dictionaryRowState({
      preferred: getSettings().dictPreferredEdition,
      inventory: dictionaryInventory(),
      job: dictionaryJob(),
      now: Date.now(),
      // The space check belongs to the surface that offers the download. This
      // row only reports, so it never needs to say an edition will not fit.
      freeBytes: undefined,
    });
    el.classList.remove("kc-ready", "kc-loading", "kc-bad");
    if (DOT_CLASS[view.dot]) el.classList.add(DOT_CLASS[view.dot]);
    if (description) description.textContent = describe(view.message);
    // `Set up` while there is nothing, `Manage` once there is: the same button,
    // named for what pressing it is for at that moment.
    manage.textContent =
      dictionaryInventory().installed.length === 0 ? t("dictSetUp") : t("dictManage");
  };

  paint();
  // Follow the status wherever it is changed from, including the dialog this
  // row opens, and surrender the subscription when the panel is rebuilt.
  const unsubscribe = onDictionaryChange(paint);
  onPanelTeardown(unsubscribe);
  return el;
}
