import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SelectionColorRow } from "../SelectionColorsSection";

// The color picker is a react-aria popover with layout effects / portals that
// add nothing to this row's chaining logic; stub it so it can't emit act()
// warnings. The ColorInput still renders its plain text <input>, which is what
// we drive.
vi.mock("@/components/ui/ColorPicker", () => ({
  CustomColorPicker: () => null,
}));

afterEach(cleanup);

function getHexInput(): HTMLInputElement {
  return screen.getByPlaceholderText("#000000") as HTMLInputElement;
}

describe("SelectionColorRow", () => {
  it("only calls onRemap for valid hex, chaining from the last committed value", () => {
    const onRemap = vi.fn();
    render(<SelectionColorRow color="#FF0000" onRemap={onRemap} />);
    const input = getHexInput();

    // Invalid intermediate: reflected in the field, never written to the store.
    fireEvent.change(input, { target: { value: "#00FF0" } });
    expect(onRemap).not.toHaveBeenCalled();
    expect(input.value).toBe("#00FF0");

    // Completing to a valid hex: remap from the original committed color.
    fireEvent.change(input, { target: { value: "#00FF00" } });
    expect(onRemap).toHaveBeenCalledTimes(1);
    expect(onRemap).toHaveBeenLastCalledWith("#FF0000", "#00FF00");

    // A further valid edit chains from the previously committed value, not the
    // original color.
    fireEvent.change(input, { target: { value: "#0000FF" } });
    expect(onRemap).toHaveBeenCalledTimes(2);
    expect(onRemap).toHaveBeenLastCalledWith("#00FF00", "#0000FF");
  });

  it("re-syncs the draft/committed value when the color prop changes", () => {
    const onRemap = vi.fn();
    const { rerender } = render(<SelectionColorRow color="#FF0000" onRemap={onRemap} />);

    // Selection changes underneath the row → new aggregated color.
    rerender(<SelectionColorRow color="#123456" onRemap={onRemap} />);
    expect(getHexInput().value).toBe("#123456");

    // The next edit chains from the freshly-synced committed value.
    fireEvent.change(getHexInput(), { target: { value: "#654321" } });
    expect(onRemap).toHaveBeenLastCalledWith("#123456", "#654321");
  });
});
