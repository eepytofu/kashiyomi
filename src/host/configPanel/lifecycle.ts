// Teardown for anything a panel row leaves running after its DOM is thrown away.

const disposers: (() => void)[] = [];

/** Register work to undo when the panel is rebuilt or closed. */
export function onPanelTeardown(dispose: () => void): void {
  disposers.push(dispose);
}

/** Run every registered teardown and empty the list. */
export function teardownPanel(): void {
  for (const dispose of disposers.splice(0)) {
    try {
      dispose();
    } catch {
      // Nothing to recover: the node is going away regardless, and the only
      // thing that matters is that the next disposer still runs.
    }
  }
}
