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
    expect(screen.queryByAltText("Fill preview")).toBeNull();
  });

  it("renders preview, mode selector and Replace button when an image is set", () => {
    render(
      <ImageFillEditor
        imageFill={{ url: "data:image/png;base64,abc", mode: "fill" }}
        onUpdate={vi.fn()}
      />,
    );
    const img = screen.getByAltText("Fill preview") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("data:image/png;base64,abc");
    expect(screen.getByText("Replace Image")).toBeTruthy();
    expect(screen.queryByText("Upload Image")).toBeNull();
    // Mode select shows the current value's label.
    expect(screen.getByText("Fill (Cover)")).toBeTruthy();
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
});
