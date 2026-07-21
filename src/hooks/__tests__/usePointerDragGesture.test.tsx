import { useEffect } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { usePointerDragGesture } from "../usePointerDragGesture";

afterEach(() => cleanup());

/** Minimal target wiring `drag.start` up to a real DOM element's
 * pointerdown, mirroring how popover.tsx / PluginPanels.tsx use the hook. */
function TestTarget({ onMove }: { onMove: (event: PointerEvent) => void }) {
  const drag = usePointerDragGesture();
  return (
    <div
      data-testid="target"
      onPointerDown={(event) => drag.start(event, onMove)}
    />
  );
}

function renderTarget(onMove: (event: PointerEvent) => void) {
  const { getByTestId } = render(<TestTarget onMove={onMove} />);
  return getByTestId("target");
}

describe("usePointerDragGesture", () => {
  it("captures the pointer and tracks pointermove after a primary-button pointerdown", () => {
    const onMove = vi.fn();
    const target = renderTarget(onMove);
    const captureSpy = vi.spyOn(target, "setPointerCapture");

    fireEvent.pointerDown(target, { button: 0, pointerId: 7 });
    expect(captureSpy).toHaveBeenCalledWith(7);

    fireEvent(window, new PointerEvent("pointermove", { clientX: 10, clientY: 20 }));
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it("ignores a non-primary-button pointerdown (no capture, no tracking)", () => {
    const onMove = vi.fn();
    const target = renderTarget(onMove);
    const captureSpy = vi.spyOn(target, "setPointerCapture");

    fireEvent.pointerDown(target, { button: 2 });
    expect(captureSpy).not.toHaveBeenCalled();

    fireEvent(window, new PointerEvent("pointermove", { clientX: 10, clientY: 20 }));
    expect(onMove).not.toHaveBeenCalled();
  });

  it("stops tracking after pointerup", () => {
    const onMove = vi.fn();
    const target = renderTarget(onMove);

    fireEvent.pointerDown(target, { button: 0 });
    fireEvent(window, new PointerEvent("pointermove", { clientX: 1, clientY: 1 }));
    fireEvent(window, new PointerEvent("pointerup", {}));
    fireEvent(window, new PointerEvent("pointermove", { clientX: 2, clientY: 2 }));

    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it("stops tracking after pointercancel", () => {
    const onMove = vi.fn();
    const target = renderTarget(onMove);

    fireEvent.pointerDown(target, { button: 0 });
    fireEvent(window, new PointerEvent("pointercancel", {}));
    fireEvent(window, new PointerEvent("pointermove", { clientX: 2, clientY: 2 }));

    expect(onMove).not.toHaveBeenCalled();
  });

  it("a fresh pointerdown supersedes an in-flight gesture that never received its pointerup", () => {
    const firstMove = vi.fn();
    const secondMove = vi.fn();
    const target = renderTarget(firstMove);

    fireEvent.pointerDown(target, { button: 0 });
    // Simulate a second gesture starting (e.g. re-render passed a fresh
    // onMove) without the first ever getting a pointerup/cancel.
    fireEvent.pointerDown(target, { button: 0 });
    fireEvent(window, new PointerEvent("pointermove", { clientX: 5, clientY: 5 }));

    // Both calls used the same `onMove` prop in this render, so the move
    // still reaches it — but only once (the stale listener from the first
    // pointerdown must have been torn down, not left stacked).
    expect(firstMove).toHaveBeenCalledTimes(1);
    expect(secondMove).not.toHaveBeenCalled();
  });

  it("cancel() tears down an in-flight gesture without waiting for pointerup", () => {
    const onMove = vi.fn();
    const cancelRef: { current: (() => void) | undefined } = { current: undefined };

    function Target() {
      const drag = usePointerDragGesture();
      useEffect(() => {
        cancelRef.current = drag.cancel;
      }, [drag]);
      return <div data-testid="target" onPointerDown={(event) => drag.start(event, onMove)} />;
    }
    const { getByTestId } = render(<Target />);

    fireEvent.pointerDown(getByTestId("target"), { button: 0 });
    cancelRef.current?.();
    fireEvent(window, new PointerEvent("pointermove", { clientX: 1, clientY: 1 }));

    expect(onMove).not.toHaveBeenCalled();
  });
});
