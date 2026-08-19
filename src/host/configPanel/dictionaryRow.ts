// Compact entry point for the dictionary manager. Edition choice and progress
// live in one dialog instead of being duplicated inside a narrow settings row.

import { t } from "../i18n.ts";
import { dictionaryInventory, onDictionaryChange } from "../dictionary.ts";
import { openDictionarySetup } from "../setup/dialog.ts";
import { onPanelTeardown } from "./lifecycle.ts";
import { row, rowText } from "./rows.ts";

export function dictionaryRow(): HTMLElement {
  const el = row();
  const text = rowText(t("dictionary"), t("dictNotInstalled"));
  const description = text.querySelector(".kc-desc") ?? text.lastElementChild;
  el.appendChild(text);

  const manage = document.createElement("button");
  manage.className = "kc-button";
  manage.onclick = () => openDictionarySetup();
  el.appendChild(manage);

  const paint = (): void => {
    const inventory = dictionaryInventory();
    if (description) {
      const edition = inventory.edition === "full" ? t("dictEditionFull") : t("dictEditionCore");
      description.textContent = inventory.installed
        ? `${edition} · ${t("dictInstalledState")}`
        : t("dictNotInstalled");
    }
    manage.textContent = inventory.installed ? t("dictManage") : t("dictSetUp");
  };

  paint();
  const unsubscribe = onDictionaryChange(paint);
  onPanelTeardown(unsubscribe);
  return el;
}
