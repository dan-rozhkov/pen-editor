import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetStores, seedScene } from "@/test/fixtures";
import { useSelectionStore } from "@/store/selectionStore";
import { copyAsCss, copyAsSvg } from "../copyAsActions";

describe("copyAsActions", () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetStores();
    seedScene();
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  it("copyAsCss writes generated CSS for the selection to the clipboard", async () => {
    useSelectionStore.setState({ selectedIds: ["rect1"] } as never);

    const result = await copyAsCss();

    expect(result).toBe(true);
    expect(writeText).toHaveBeenCalledTimes(1);
    const written = writeText.mock.calls[0][0] as string;
    expect(written).toContain("/* Box */");
    expect(written).toContain("background-color: #ff0000");
  });

  it("copyAsSvg writes generated SVG for the selection to the clipboard", async () => {
    useSelectionStore.setState({ selectedIds: ["rect1"] } as never);

    const result = await copyAsSvg();

    expect(result).toBe(true);
    expect(writeText).toHaveBeenCalledTimes(1);
    const written = writeText.mock.calls[0][0] as string;
    expect(written).toContain("<svg");
    expect(written).toContain("</svg>");
  });

  it("is a no-op when there is no selection", async () => {
    useSelectionStore.setState({ selectedIds: [] } as never);

    expect(await copyAsCss()).toBe(false);
    expect(await copyAsSvg()).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });
});
