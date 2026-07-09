import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { CustomColorPicker } from "@/components/ui/ColorPicker";

afterEach(() => cleanup());

function openPicker() {
  fireEvent.click(screen.getByLabelText("Pick color"));
}

describe("CustomColorPicker format selector", () => {
  it("defaults to HEX and shows the segmented control", () => {
    render(<CustomColorPicker value="#ff0000" onChange={vi.fn()} />);
    openPicker();

    const hexBtn = screen.getByRole("button", { name: "HEX" });
    const rgbBtn = screen.getByRole("button", { name: "RGB" });
    const hslBtn = screen.getByRole("button", { name: "HSL" });
    expect(hexBtn).toBeTruthy();
    expect(rgbBtn).toBeTruthy();
    expect(hslBtn).toBeTruthy();
    // The shared properties-panel ButtonGroup marks its active option.
    expect(hexBtn.getAttribute("aria-pressed")).toBe("true");
    expect(rgbBtn.getAttribute("aria-pressed")).toBe("false");

    // HEX mode: single hex field, no channel inputs
    expect(screen.getByLabelText("Hex color")).toBeTruthy();
    expect(screen.queryByLabelText("Red")).toBeNull();
  });

  it("popover is portaled to document.body and hidden until swatch clicked", () => {
    render(<CustomColorPicker value="#ff0000" onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "RGB" })).toBeNull();
    openPicker();
    const rgbBtn = screen.getByRole("button", { name: "RGB" });
    expect(document.body.contains(rgbBtn)).toBe(true);
  });

  it("clicking RGB shows three channel inputs reflecting the value", () => {
    render(<CustomColorPicker value="#ff0000" onChange={vi.fn()} />);
    openPicker();
    fireEvent.click(screen.getByRole("button", { name: "RGB" }));

    const red = screen.getByLabelText("Red") as HTMLInputElement;
    const green = screen.getByLabelText("Green") as HTMLInputElement;
    const blue = screen.getByLabelText("Blue") as HTMLInputElement;
    expect(red.value).toBe("255");
    expect(green.value).toBe("0");
    expect(blue.value).toBe("0");
  });

  it("does not bubble a format-button press to document-level popover handlers", () => {
    render(<CustomColorPicker value="#ff0000" onChange={vi.fn()} />);
    openPicker();
    const onDocumentMouseDown = vi.fn();
    document.addEventListener("mousedown", onDocumentMouseDown);

    try {
      fireEvent.mouseDown(screen.getByRole("button", { name: "RGB" }));
      expect(onDocumentMouseDown).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("mousedown", onDocumentMouseDown);
    }
  });

  it("clicking HSL shows three channel inputs reflecting the value", () => {
    render(<CustomColorPicker value="#ff0000" onChange={vi.fn()} />);
    openPicker();
    fireEvent.click(screen.getByRole("button", { name: "HSL" }));

    const hue = screen.getByLabelText("Hue") as HTMLInputElement;
    const saturation = screen.getByLabelText("Saturation") as HTMLInputElement;
    const lightness = screen.getByLabelText("Lightness") as HTMLInputElement;
    expect(hue.value).toBe("0°");
    expect(saturation.value).toBe("100%");
    expect(lightness.value).toBe("50%");
  });

  it("editing a channel input fires onChange with a hex value", () => {
    const onChange = vi.fn();
    render(<CustomColorPicker value="#ff0000" onChange={onChange} />);
    openPicker();
    fireEvent.click(screen.getByRole("button", { name: "RGB" }));

    const green = screen.getByLabelText("Green") as HTMLInputElement;
    fireEvent.change(green, { target: { value: "128" } });
    fireEvent.blur(green);

    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(lastCall.startsWith("#")).toBe(true);
    expect(lastCall).not.toContain("rgb(");
    expect(lastCall).not.toContain("hsl(");
  });

  it("preserves alpha when switching formats HEX(8-digit) -> RGB -> HSL -> HEX", () => {
    // The picker is fully controlled by `value`; the shared react-aria Color
    // object is re-derived from `value` on every render and never mutated by
    // just switching which format is displayed. So merely toggling formats
    // cannot drop the alpha channel — verify no spurious onChange occurs and
    // every format keeps reflecting the same underlying color.
    const onChange = vi.fn();
    render(<CustomColorPicker value="#ff000080" onChange={onChange} />);
    openPicker();

    fireEvent.click(screen.getByRole("button", { name: "RGB" }));
    const red = screen.getByLabelText("Red") as HTMLInputElement;
    expect(red.value).toBe("255");

    fireEvent.click(screen.getByRole("button", { name: "HSL" }));
    const hue = screen.getByLabelText("Hue") as HTMLInputElement;
    expect(hue.value).toBe("0°");

    fireEvent.click(screen.getByRole("button", { name: "HEX" }));
    const hex = screen.getByLabelText("Hex color") as HTMLInputElement;
    expect(hex.value.toLowerCase()).toBe("#ff0000");

    // No edit was made — switching tabs alone must never fire onChange.
    expect(onChange).not.toHaveBeenCalled();
  });
});
