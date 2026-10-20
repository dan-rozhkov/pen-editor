/** Base UI's trigger toggles the menu itself; a control whose own onClick is the only toggle calls this first. */
export function skipBaseUiOpen(event: unknown) {
  (event as { preventBaseUIHandler?: () => void }).preventBaseUIHandler?.();
}
