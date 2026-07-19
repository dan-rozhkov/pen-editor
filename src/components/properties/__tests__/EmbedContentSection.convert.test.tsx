import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: toastError, success: vi.fn() }),
}));

import { EmbedContentSection } from "../EmbedContentSection";
import { useSceneStore } from "@/store/sceneStore";
import type { EmbedNode } from "@/types/scene";

const node = {
  id: "e1",
  type: "embed",
  x: 0,
  y: 0,
  width: 100,
  height: 80,
  htmlContent: "<div>hi</div>",
} as unknown as EmbedNode;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  toastError.mockClear();
});

describe("<EmbedContentSection /> convert-to-design failure handling", () => {
  it("shows the canvas loader while conversion is in progress without disabling the button", () => {
    let resolveConversion: (frameId: string | null) => void;
    const convertEmbedToDesign = vi.fn(
      () => new Promise<string | null>((resolve) => {
        resolveConversion = resolve;
      }),
    );
    useSceneStore.setState({ convertEmbedToDesign });

    render(<EmbedContentSection node={node} />);
    const button = screen.getByRole("button", { name: "Convert to Design" });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(convertEmbedToDesign).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("aria-label")).toBe("Converting to Design");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.querySelector("svg")?.classList.contains("animate-spin")).toBe(true);

    resolveConversion!(null);
  });

  it("surfaces a toast and console.error when conversion rejects, and re-enables the button", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("capture blew up");
    const convertEmbedToDesign = vi.fn().mockRejectedValue(failure);
    useSceneStore.setState({ convertEmbedToDesign });

    render(<EmbedContentSection node={node} />);
    const button = screen.getByText("Convert to Design");
    fireEvent.click(button);

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError.mock.calls[0][0]).toMatch(/couldn't convert/i);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to convert embed to design:",
      failure,
    );
    // isConverting reset via finally — the regular button content is restored.
    await waitFor(() => expect(screen.getByText("Convert to Design")).toBeTruthy());
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
});
