import { useCallback, useMemo, useRef, type PointerEvent as ReactPointerEvent } from "react";

/**
 * Shared pointer-capture drag/resize gesture wiring: `setPointerCapture` on
 * the target, track `pointermove` at the window level until `pointerup`/
 * `pointercancel`, and tear down cleanly on interruption (a fresh gesture
 * superseding an in-flight one, or the component unmounting mid-drag).
 *
 * This was previously hand-rolled three times with identical boilerplate —
 * `popover.tsx`'s tear-off drag, `PluginPanels`' titlebar drag, and its
 * resize handle — each with its own cleanup-ref pattern. The math that
 * differs per call site (computing the next position/size from the pointer
 * delta) stays with the caller: `start` takes the pointerdown event and an
 * `onMove` callback built fresh at that moment (so it can close over
 * whatever origin/size the gesture started from) and only handles the
 * capture + listener lifecycle.
 */
export function usePointerDragGesture() {
  const cleanupRef = useRef<(() => void) | null>(null);

  const start = useCallback(
    <T extends Element>(event: ReactPointerEvent<T>, onMove: (moveEvent: PointerEvent) => void) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      // Clear any prior gesture that never received its pointerup (e.g. a
      // stray pointercancel that raced this new pointerdown).
      cleanupRef.current?.();

      const handleMove = (moveEvent: PointerEvent) => onMove(moveEvent);
      const cleanup = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", cleanup);
        window.removeEventListener("pointercancel", cleanup);
        cleanupRef.current = null;
      };
      cleanupRef.current = cleanup;
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", cleanup);
      window.addEventListener("pointercancel", cleanup);
    },
    [],
  );

  /** Tear down an in-progress gesture's window listeners without waiting for
   * pointerup — call this from an unmount effect (component torn down
   * mid-drag) the same way each call site used to. Safe to call when no
   * gesture is in flight. */
  const cancel = useCallback(() => {
    cleanupRef.current?.();
  }, []);

  // Memoized so callers can safely put the returned object in a dependency
  // array (e.g. an unmount-cleanup `useEffect(() => () => api.cancel(), [api])`)
  // without it "changing" every render — `start`/`cancel` are themselves
  // already stable (`useCallback` with no deps), but a fresh `{ start, cancel }`
  // literal every render would otherwise still count as a new dependency and
  // re-fire that effect's cleanup on every unrelated re-render, tearing down
  // an in-flight gesture's listeners before pointerup ever arrives.
  return useMemo(() => ({ start, cancel }), [start, cancel]);
}
