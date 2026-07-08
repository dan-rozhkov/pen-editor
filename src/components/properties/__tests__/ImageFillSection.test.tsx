import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ImageFillEditor } from "../ImageFillSection";
import type { ImageFillMode } from "@/types/scene";

afterEach(() => cleanup());

describe("<ImageFillEditor />", () => {
  it("renders an Upload button when there is no image fill", () => {
    render(<ImageFillEditor imageFill={undefined} onUpdate={vi.fn()} />);
    expect(screen.getByText("Upload Image")).toBeTruthy();
    expect(screen.queryByText("Replace Image")).toBeNull();
    expect(screen.queryByRole("img", { name: "Fill preview" })).toBeNull();
  });

  it("renders preview, mode selector and Replace button when an image is set", () => {
    render(
      <ImageFillEditor
        imageFill={{ url: "data:image/png;base64,abc", mode: "fill" }}
        onUpdate={vi.fn()}
      />,
    );
    const preview = screen.getByRole("img", { name: "Fill preview" }) as HTMLElement;
    expect(preview.style.backgroundImage).toBe('url("data:image/png;base64,abc")');
    // Uncropped "fill" mode previews with the same size/position technique as HTML export.
    expect(preview.style.backgroundSize).toBe("cover");
    expect(preview.style.backgroundPosition).toBe("center center");
    expect(screen.getByText("Replace Image")).toBeTruthy();
    expect(screen.queryByText("Upload Image")).toBeNull();
    // Mode select shows the current value's label.
    expect(screen.getByText("Fill (Cover)")).toBeTruthy();
  });

  it("maps a crop rect to background-size/position percentages in the preview", () => {
    render(
      <ImageFillEditor
        imageFill={{
          url: "data:image/png;base64,abc",
          mode: "fill",
          crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
        }}
        onUpdate={vi.fn()}
      />,
    );
    const preview = screen.getByRole("img", { name: "Fill preview" }) as HTMLElement;
    expect(preview.style.backgroundSize).toBe("200% 100%");
    expect(preview.style.backgroundPosition).toBe("50% 0%");
  });

  it("applies a CSS filter approximation of non-default adjustments to the preview", () => {
    render(
      <ImageFillEditor
        imageFill={{
          url: "data:image/png;base64,abc",
          mode: "fill",
          adjustments: { brightness: 20, contrast: 0, saturation: 0, temperature: 0, tint: 0 },
        }}
        onUpdate={vi.fn()}
      />,
    );
    const preview = screen.getByRole("img", { name: "Fill preview" }) as HTMLElement;
    expect(preview.style.filter).toBe("brightness(1.2) contrast(1) saturate(1)");
  });

  it("leaves the preview filter unset for default adjustments", () => {
    render(
      <ImageFillEditor
        imageFill={{ url: "data:image/png;base64,abc", mode: "fill" }}
        onUpdate={vi.fn()}
      />,
    );
    const preview = screen.getByRole("img", { name: "Fill preview" }) as HTMLElement;
    expect(preview.style.filter).toBe("");
  });

  it("shows the matching label for the 'fit' mode", () => {
    render(
      <ImageFillEditor
        imageFill={{ url: "data:image/png;base64,abc", mode: "fit" }}
        onUpdate={vi.fn()}
      />,
    );
    expect(screen.getByText("Fit (Contain)")).toBeTruthy();
  });

  it("renders the 'stretch' mode label in the mode selector", () => {
    // base-ui Select dropdowns are flaky in happy-dom (and emit act warnings
    // when driven), so we assert the selected value's label renders in the
    // trigger rather than opening the dropdown.
    render(
      <ImageFillEditor
        imageFill={{ url: "data:image/png;base64,abc", mode: "stretch" }}
        onUpdate={vi.fn()}
      />,
    );
    expect(screen.getByText("Stretch")).toBeTruthy();
  });

  it("reads the dropped file and emits a data-url imageFill on upload", async () => {
    const onUpdate = vi.fn();
    const { container } = render(
      <ImageFillEditor imageFill={undefined} onUpdate={onUpdate} />,
    );

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    const file = new File(["hello"], "pic.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    const arg = onUpdate.mock.calls[0][0] as {
      imageFill: { url: string; mode: ImageFillMode };
    };
    expect(arg.imageFill.url).toMatch(/^data:/);
    // No existing fill -> default mode "fill".
    expect(arg.imageFill.mode).toBe("fill");
  });

  it("preserves the existing mode when replacing the image", async () => {
    const onUpdate = vi.fn();
    const { container } = render(
      <ImageFillEditor
        imageFill={{ url: "data:image/png;base64,old", mode: "fit" }}
        onUpdate={onUpdate}
      />,
    );
    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;

    const file = new File(["bytes"], "new.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    const arg = onUpdate.mock.calls[0][0] as {
      imageFill: { url: string; mode: ImageFillMode };
    };
    expect(arg.imageFill.mode).toBe("fit");
  });

  it("does nothing when the file dialog is cancelled (no file)", () => {
    const onUpdate = vi.fn();
    const { container } = render(
      <ImageFillEditor imageFill={undefined} onUpdate={onUpdate} />,
    );
    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;

    fireEvent.change(fileInput, { target: { files: [] } });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("does not show a Reset Crop button when the image is uncropped", () => {
    render(
      <ImageFillEditor
        imageFill={{ url: "data:image/png;base64,abc", mode: "fill" }}
        onUpdate={vi.fn()}
      />,
    );
    expect(screen.queryByText("Reset Crop")).toBeNull();
  });

  it("opens the crop editor and emits a clamped crop rect on the Left field", () => {
    const onUpdate = vi.fn();
    const { container } = render(
      <ImageFillEditor
        imageFill={{ url: "data:image/png;base64,abc", mode: "fill" }}
        onUpdate={onUpdate}
      />,
    );

    fireEvent.click(screen.getByText("Crop"));
    const numberInputs = container.querySelectorAll('input[type="number"]');
    // Left, Top, Width, Height (crop) + Brightness, Contrast, Saturation, Temperature, Tint (adjustments).
    expect(numberInputs.length).toBe(9);
    const leftInput = numberInputs[0] as HTMLInputElement;
    fireEvent.change(leftInput, { target: { value: "150" } }); // out-of-range, should clamp

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const arg = onUpdate.mock.calls[0][0] as {
      imageFill: { crop?: { x: number; y: number; width: number; height: number } };
    };
    expect(arg.imageFill.crop).toBeDefined();
    // 150% clamps down to leave room for the default full width (1 - width).
    expect(arg.imageFill.crop!.x).toBeLessThanOrEqual(1);
    expect(arg.imageFill.crop!.width).toBeGreaterThan(0);
  });

  it("shows Reset Crop and clears the crop when clicked", () => {
    const onUpdate = vi.fn();
    render(
      <ImageFillEditor
        imageFill={{
          url: "data:image/png;base64,abc",
          mode: "fill",
          crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
        }}
        onUpdate={onUpdate}
      />,
    );

    expect(screen.getByText("Reset Crop")).toBeTruthy();
    fireEvent.click(screen.getByText("Reset Crop"));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const arg = onUpdate.mock.calls[0][0] as { imageFill: { crop?: unknown } };
    expect(arg.imageFill.crop).toBeUndefined();
  });

  it("renders an Adjustments section with 5 sliders and no Reset button when unadjusted", () => {
    render(
      <ImageFillEditor
        imageFill={{ url: "data:image/png;base64,abc", mode: "fill" }}
        onUpdate={vi.fn()}
      />,
    );
    expect(screen.getByText("Adjustments")).toBeTruthy();
    expect(screen.getByText("Brightness")).toBeTruthy();
    expect(screen.getByText("Contrast")).toBeTruthy();
    expect(screen.getByText("Saturation")).toBeTruthy();
    expect(screen.getByText("Temperature")).toBeTruthy();
    expect(screen.getByText("Tint")).toBeTruthy();
    expect(screen.queryByText("Reset")).toBeNull();
  });

  it("emits a clamped adjustments object when a slider changes", () => {
    const onUpdate = vi.fn();
    const { container } = render(
      <ImageFillEditor
        imageFill={{ url: "data:image/png;base64,abc", mode: "fill" }}
        onUpdate={onUpdate}
      />,
    );

    const numberInputs = container.querySelectorAll('input[type="number"]');
    // Brightness is the first of the 5 adjustment fields.
    const brightnessInput = numberInputs[0] as HTMLInputElement;
    fireEvent.change(brightnessInput, { target: { value: "500" } }); // out-of-range, should clamp

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const arg = onUpdate.mock.calls[0][0] as { imageFill: { adjustments?: Record<string, number> } };
    expect(arg.imageFill.adjustments).toEqual({
      brightness: 100,
      contrast: 0,
      saturation: 0,
      temperature: 0,
      tint: 0,
    });
  });

  it("shows a Reset button when adjustments are non-default and clears them on click", () => {
    const onUpdate = vi.fn();
    render(
      <ImageFillEditor
        imageFill={{
          url: "data:image/png;base64,abc",
          mode: "fill",
          adjustments: { brightness: 20, contrast: 0, saturation: 0, temperature: 0, tint: 0 },
        }}
        onUpdate={onUpdate}
      />,
    );

    expect(screen.getByText("Reset")).toBeTruthy();
    fireEvent.click(screen.getByText("Reset"));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const arg = onUpdate.mock.calls[0][0] as { imageFill: { adjustments?: unknown } };
    expect(arg.imageFill.adjustments).toBeUndefined();
  });
});
