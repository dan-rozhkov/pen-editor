import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { PatternFillEditor } from "../PatternFillSection";
import type { PatternFill } from "@/types/scene";

afterEach(() => cleanup());

const pattern = (overrides: Partial<PatternFill> = {}): PatternFill => ({
  url: "data:image/png;base64,abc",
  ...overrides,
});

/** Number inputs render in a fixed order: Scale, Gap X, Gap Y, Offset X, Offset Y, Row offset. */
function numberInputs(container: HTMLElement): HTMLInputElement[] {
  return Array.from(container.querySelectorAll('input[type="number"]'));
}

describe("<PatternFillEditor />", () => {
  it("renders an Upload button when there is no tile yet", () => {
    render(<PatternFillEditor pattern={pattern({ url: "" })} onChange={vi.fn()} />);
    expect(screen.getByText("Upload Tile")).toBeTruthy();
    expect(screen.queryByText("Replace Tile")).toBeNull();
    expect(screen.queryByAltText("Tile preview")).toBeNull();
  });

  it("renders preview, tiling controls, and Replace button when a tile is set", () => {
    const { container } = render(
      <PatternFillEditor pattern={pattern()} onChange={vi.fn()} />,
    );
    const img = screen.getByAltText("Tile preview") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("data:image/png;base64,abc");
    const replaceButton = screen.getByText("Replace Tile");
    const overlay = replaceButton.parentElement;
    expect(overlay?.className).toContain("bg-black/35");
    expect(overlay?.className).toContain("justify-center");
    expect(replaceButton.className).toContain("w-auto");
    expect(img.parentElement?.contains(replaceButton)).toBe(true);
    for (const label of ["Scale", "Gap X", "Gap Y", "Offset X", "Offset Y", "Row offset"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(numberInputs(container)).toHaveLength(6);
  });

  it("shows defaults (scale 100%, gaps/offsets 0) and stored values", () => {
    const { container } = render(
      <PatternFillEditor
        pattern={pattern({ scale: 0.5, spacingX: 4, rowOffset: 0.25 })}
        onChange={vi.fn()}
      />,
    );
    const [scale, gapX, gapY, offsetX, offsetY, rowOffset] = numberInputs(container);
    expect(scale.value).toBe("50");
    expect(gapX.value).toBe("4");
    expect(gapY.value).toBe("0");
    expect(offsetX.value).toBe("0");
    expect(offsetY.value).toBe("0");
    expect(rowOffset.value).toBe("25");
  });

  it("emits scale as a factor (percent input / 100)", () => {
    const onChange = vi.fn();
    const { container } = render(
      <PatternFillEditor pattern={pattern()} onChange={onChange} />,
    );
    const scaleInput = numberInputs(container)[0];
    fireEvent.focus(scaleInput);
    fireEvent.change(scaleInput, { target: { value: "200" } });
    fireEvent.blur(scaleInput);
    expect(onChange).toHaveBeenCalledWith(pattern({ scale: 2 }));
  });

  it("emits spacing and offsets in px, clamping negative spacing to 0", () => {
    const onChange = vi.fn();
    // Seed a non-zero spacingX: the default is already 0 (the clamp floor),
    // so clamping -3 back to 0 from an unset/0 start would be a no-op commit
    // under the new "skip unchanged" rule.
    const { container } = render(
      <PatternFillEditor pattern={pattern({ spacingX: 4 })} onChange={onChange} />,
    );
    const [, gapX, , offsetX] = numberInputs(container);
    fireEvent.focus(gapX);
    fireEvent.change(gapX, { target: { value: "-3" } });
    fireEvent.blur(gapX);
    expect(onChange).toHaveBeenLastCalledWith(pattern({ spacingX: 0 }));
    fireEvent.focus(offsetX);
    fireEvent.change(offsetX, { target: { value: "-7" } });
    fireEvent.blur(offsetX);
    expect(onChange).toHaveBeenLastCalledWith(pattern({ spacingX: 4, offsetX: -7 }));
  });

  it("emits rowOffset as a 0-1 fraction, clamped to [0, 1]", () => {
    const onChange = vi.fn();
    const { container } = render(
      <PatternFillEditor pattern={pattern()} onChange={onChange} />,
    );
    const rowOffset = numberInputs(container)[5];
    fireEvent.focus(rowOffset);
    fireEvent.change(rowOffset, { target: { value: "50" } });
    fireEvent.blur(rowOffset);
    expect(onChange).toHaveBeenLastCalledWith(pattern({ rowOffset: 0.5 }));
    fireEvent.focus(rowOffset);
    fireEvent.change(rowOffset, { target: { value: "150" } });
    fireEvent.blur(rowOffset);
    expect(onChange).toHaveBeenLastCalledWith(pattern({ rowOffset: 1 }));
  });

  it("reads an uploaded file and emits the data-url tile, keeping other params", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <PatternFillEditor pattern={pattern({ url: "", scale: 2 })} onChange={onChange} />,
    );
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["tile-bytes"], "tile.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = onChange.mock.calls[0][0] as PatternFill;
    expect(next.url.startsWith("data:")).toBe(true);
    expect(next.scale).toBe(2);
  });

  it("replaces an existing tile from the preview overlay and keeps other params", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <PatternFillEditor pattern={pattern({ scale: 2 })} onChange={onChange} />,
    );
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["new-tile"], "new-tile.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = onChange.mock.calls[0][0] as PatternFill;
    expect(next.url.startsWith("data:")).toBe(true);
    expect(next.scale).toBe(2);
  });
});
