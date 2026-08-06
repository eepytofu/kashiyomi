// Teardown for anything a panel row leaves running after its DOM is thrown away.
//
// The panel rebuilds itself from scratch on four paths: both language buttons,
// the provider dropdown, and Re-annotate. Each rebuild used to add another
// permanent subscriber to the dictionary's change list, because the row
// discarded the unsubscribe function it was handed. The detached rows kept
// painting into nodes no longer in the document, so the cost was invisible and
// unbounded: four rebuilds meant five copies of every repaint, forever.
//
// A registry rather than a return value on every builder, so a row opts in with
// one line at the point it creates the thing that needs cleaning up, next to
// the code that made it.

const disposers: (() => void)[] = [];

/** Register work to undo when the panel is rebuilt or closed. */
export function onPanelTeardown(dispose: () => void): void {
  disposers.push(dispose);
}

/**
 * Run every registered teardown and empty the list.
 *
 * Each is guarded: one throwing disposer must not strand the rest, or a rebuild
 * that half-tears-down leaves exactly the leak this exists to prevent.
 */
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
