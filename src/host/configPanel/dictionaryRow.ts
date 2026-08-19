import { dictionarySnapshot, onDictionaryChange } from "../dictionary.ts";
import { openDictionarySetup } from "../setup/dialog.ts";
import { t, tDictionaryPhase } from "../i18n.ts";
import { onPanelTeardown } from "./lifecycle.ts";
import { row, rowText } from "./rows.ts";
import { uiButton } from "../uiPrimitives.ts";

export function dictionaryRow(): HTMLElement {
  const element = row();
  const text = rowText(t("dictionary"), t("dictNotInstalled"));
  const description = text.querySelector(".kc-desc") ?? text.lastElementChild;
  element.appendChild(text);
  const manage = uiButton("", { className: "kc-dictionary-manage" });
  manage.onclick = () => openDictionarySetup();
  element.appendChild(manage);

  const paint = (): void => {
    const snapshot = dictionarySnapshot();
    const operation = snapshot.operation;
    if (description) {
      if (operation?.state === "running") {
        const edition = operation.edition === "full" ? t("dictEditionFull") : t("dictEditionCore");
        description.textContent = operation.edition ? `${edition} · ${tDictionaryPhase(operation.phase)}` : tDictionaryPhase(operation.phase);
      } else if (snapshot.active) {
        const edition = snapshot.active === "full" ? t("dictEditionFull") : t("dictEditionCore");
        description.textContent = `${edition} · ${t("dictEditionInUse")}`;
      } else {
        description.textContent = t("dictNotInstalled");
      }
    }
    manage.textContent = snapshot.installed.length > 0 ? t("dictManage") : t("dictSetUp");
  };
  paint();
  onPanelTeardown(onDictionaryChange(paint));
  return element;
}
