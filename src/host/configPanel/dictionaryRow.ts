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
import { dictionaryRowState } from "../../engine/dictionaryRowState.ts";
import { describe } from "../dictionaryText.ts";
import { openDictionarySetup } from "../setup/dialog.ts";
import { getSettings } from "../settings.ts";
import { onPanelTeardown } from "./lifecycle.ts";
import { row, rowText } from "./rows.ts";

export function dictionaryRow(): HTMLElement {
  const el = row();
  const text = rowText(t("dictionary"), t("dictNotInstalled"));
  const description = text.querySelector(".kc-desc") ?? text.lastElementChild;
  // No status dot. The analyzer bar directly above already carries one, and a
  // second dot on a downloadable asset says nothing a reader can act on: the
  // description underneath already reads "installed" or "not installed".
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
      // A download running anywhere still shows here; its *outcome* does not.
      // The row reports what is installed, and "already the newest release" on
      // a row nobody pressed is a claim about a check it did not make.
      ownsJob: false,
    });
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
