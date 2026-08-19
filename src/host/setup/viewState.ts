import type { DictionaryEdition } from "../../engine/dictionarySource.ts";
import {
  fallbackEdition,
  installedEdition,
  type DictionaryErrorCode,
  type DictionaryOperation,
  type DictionarySnapshot,
} from "../../engine/dictionaryState.ts";

export type DictionaryUiError = DictionaryErrorCode | "cancelUnavailable";

export type DictionaryDialogView =
  | {
    readonly kind: "remove";
    readonly edition: DictionaryEdition;
    readonly fallback?: DictionaryEdition;
    readonly stopsAnnotation: boolean;
  }
  | { readonly kind: "progress"; readonly operation: DictionaryOperation }
  | { readonly kind: "failure"; readonly errorCode: DictionaryUiError }
  | { readonly kind: "cancelled" }
  | { readonly kind: "first-run"; readonly canInstallSelected: boolean }
  | { readonly kind: "manage" };

export type DictionaryEditionAction = "install-use" | "use" | "update" | "update-use";

/** The only primary action shown for an edition in management mode. */
export function dictionaryEditionAction(
  snapshot: DictionarySnapshot,
  edition: DictionaryEdition,
): DictionaryEditionAction | undefined {
  const installed = installedEdition(snapshot, edition);
  if (!installed) return "install-use";
  if (installed.updateAvailable) return snapshot.active === edition ? "update" : "update-use";
  return snapshot.active === edition ? undefined : "use";
}

/** One precedence ladder for every dialog branch, independent from the DOM. */
export function dictionaryDialogView(
  snapshot: DictionarySnapshot,
  options: {
    readonly firstRun: boolean;
    readonly selected: DictionaryEdition;
    readonly confirmRemove?: DictionaryEdition;
    readonly commandError?: DictionaryUiError;
  },
): DictionaryDialogView {
  if (options.confirmRemove) {
    const removingActive = snapshot.active === options.confirmRemove;
    return {
      kind: "remove",
      edition: options.confirmRemove,
      fallback: removingActive ? fallbackEdition(snapshot, options.confirmRemove) : undefined,
      stopsAnnotation: removingActive && snapshot.installed.length === 1,
    };
  }
  const operation = snapshot.operation;
  if (operation?.state === "running") return { kind: "progress", operation };
  if (options.commandError || operation?.state === "failed") {
    return { kind: "failure", errorCode: options.commandError ?? operation?.errorCode ?? "io" };
  }
  if (operation?.state === "cancelled") return { kind: "cancelled" };
  if (!options.firstRun) return { kind: "manage" };
  const selected = installedEdition(snapshot, options.selected);
  return { kind: "first-run", canInstallSelected: !selected || selected.updateAvailable };
}
