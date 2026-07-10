import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

afterEach(() => cleanup());

function renderPopover(draggable: boolean) {
  render(
    <Popover open>
      <PopoverTrigger>Open</PopoverTrigger>
      <PopoverContent draggable={draggable}>
        <div>Content</div>
      </PopoverContent>
    </Popover>,
  );
}

/** The Positioner is the drag handle's grandparent: Positioner > Popup > handle. */
function positionerOf(handle: HTMLElement): HTMLElement {
  const positioner = handle.parentElement?.parentElement;
  if (!positioner) throw new Error("Positioner not found");
  return positioner;
}

describe("PopoverContent draggable", () => {
  it("renders no drag handle by default (opt-in)", () => {
    renderPopover(false);
    expect(screen.queryByTitle("Drag to move")).toBeNull();
  });

  it("renders a drag handle when draggable is set", () => {
    renderPopover(true);
    expect(screen.getByTitle("Drag to move")).toBeTruthy();
  });

  it("stays anchor-positioned (no inline position override) before any drag", () => {
    renderPopover(true);
    const handle = screen.getByTitle("Drag to move");
    expect(positionerOf(handle).style.position).not.toBe("fixed");
  });

  it("tears off into a fixed, pointer-tracked position once dragged", () => {
    renderPopover(true);
    const handle = screen.getByTitle("Drag to move");
    const positioner = positionerOf(handle);

    fireEvent.pointerDown(handle, { button: 0, clientX: 100, clientY: 100 });
    // Torn off immediately at the pre-drag position, before any move.
    expect(positioner.style.position).toBe("fixed");

    fireEvent(window, new PointerEvent("pointermove", { clientX: 150, clientY: 180 }));
    // happy-dom's getBoundingClientRect is all-zero, so the anchored origin
    // is (0, 0); dragging by (+50, +80) should land there, clamped to the
    // (non-zero) viewport.
    expect(positioner.style.left).toBe("50px");
    expect(positioner.style.top).toBe("80px");
  });

  it("stops tracking the pointer after pointerup", () => {
    renderPopover(true);
    const handle = screen.getByTitle("Drag to move");
    const positioner = positionerOf(handle);

    fireEvent.pointerDown(handle, { button: 0, clientX: 100, clientY: 100 });
    fireEvent(window, new PointerEvent("pointermove", { clientX: 150, clientY: 180 }));
    fireEvent(window, new PointerEvent("pointerup", { clientX: 150, clientY: 180 }));
    fireEvent(window, new PointerEvent("pointermove", { clientX: 999, clientY: 999 }));

    expect(positioner.style.left).toBe("50px");
    expect(positioner.style.top).toBe("80px");
  });

  it("clamps the torn-off position to the viewport", () => {
    renderPopover(true);
    const handle = screen.getByTitle("Drag to move");
    const positioner = positionerOf(handle);

    fireEvent.pointerDown(handle, { button: 0, clientX: 100, clientY: 100 });
    fireEvent(window, new PointerEvent("pointermove", { clientX: 100000, clientY: 100000 }));

    const left = Number.parseFloat(positioner.style.left);
    const top = Number.parseFloat(positioner.style.top);
    expect(left).toBeLessThanOrEqual(window.innerWidth);
    expect(top).toBeLessThanOrEqual(window.innerHeight);
  });
});
