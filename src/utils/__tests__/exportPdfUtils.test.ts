import { describe, it, expect, beforeEach } from "vitest";
import {
  getFrameDescriptor,
  getTopLevelFrames,
  resolvePdfDownloadFilename,
  type PdfFrameDescriptor,
} from "@/utils/exportPdfUtils";
import { useSceneStore } from "@/store/sceneStore";
import type { FlatSceneNode } from "@/types/scene";
import { resetStores } from "@/test/fixtures";

describe("resolvePdfDownloadFilename", () => {
  const frames: PdfFrameDescriptor[] = [{ id: "f1", name: "Icon", width: 10, height: 10 }];

  it("uses the provided final filename verbatim, keeping the @Nx scale label", () => {
    // Regression: the PDF runner used to strip .pdf then re-sanitize, turning
    // "Icon@2x.pdf" into "Icon_2x.pdf" and diverging from the reported filename.
    expect(resolvePdfDownloadFilename("Icon@2x.pdf", frames)).toBe("Icon@2x.pdf");
    expect(resolvePdfDownloadFilename("Icon@2x.pdf", frames)).toContain("@2x");
  });

  it("derives a safe single-frame name when no filename is given", () => {
    expect(resolvePdfDownloadFilename(undefined, frames)).toBe("Icon.pdf");
  });

  it("falls back to canvas.pdf for a multi-frame export with no filename", () => {
    const multi: PdfFrameDescriptor[] = [
      { id: "f1", name: "A", width: 10, height: 10 },
      { id: "f2", name: "B", width: 10, height: 10 },
    ];
    expect(resolvePdfDownloadFilename(undefined, multi)).toBe("canvas.pdf");
  });

  it("sanitizes the derived single-frame name", () => {
    const messy: PdfFrameDescriptor[] = [{ id: "f1", name: "My Frame / v2", width: 10, height: 10 }];
    expect(resolvePdfDownloadFilename(undefined, messy)).toBe("My_Frame___v2.pdf");
  });
});

describe("getFrameDescriptor / getTopLevelFrames (PDF page sizing & order)", () => {
  /** Column auto-layout frame, height=fit_content, stored height stale/wrong. */
  function seedHugContentFrame(id: string, stored: { width: number; height: number }): void {
    const frame = {
      id,
      type: "frame",
      name: id,
      x: 0,
      y: 0,
      width: stored.width,
      height: stored.height,
      layout: {
        autoLayout: true,
        flexDirection: "column",
        gap: 0,
        paddingTop: 0,
        paddingRight: 0,
        paddingBottom: 0,
        paddingLeft: 0,
      },
      sizing: { widthMode: "fixed", heightMode: "fit_content" },
    } as unknown as FlatSceneNode;

    const child = {
      id: `${id}-child`,
      type: "rect",
      x: 0,
      y: 0,
      width: stored.width,
      height: 40,
      sizing: { widthMode: "fixed", heightMode: "fixed" },
    } as unknown as FlatSceneNode;

    useSceneStore.setState((s) => ({
      nodesById: { ...s.nodesById, [id]: frame, [`${id}-child`]: child },
      parentById: { ...s.parentById, [id]: null, [`${id}-child`]: id },
      childrenById: { ...s.childrenById, [id]: [`${id}-child`] },
      rootIds: [...s.rootIds, id],
      _cachedTree: null,
    }));
  }

  beforeEach(() => {
    resetStores();
  });

  it("resolves the effective (hug-content) size instead of the raw stored width/height", () => {
    // Stored height (200) is stale; the frame actually hugs its one 40px-tall child.
    seedHugContentFrame("f1", { width: 100, height: 200 });

    const descriptor = getFrameDescriptor("f1", "f1");

    expect(descriptor.width).toBe(100);
    expect(descriptor.height).toBe(40);
  });

  it("orders top-level frames to match the Layers panel (reverse of rootIds)", () => {
    seedHugContentFrame("first", { width: 50, height: 50 });
    seedHugContentFrame("second", { width: 50, height: 50 });

    expect(useSceneStore.getState().rootIds).toEqual(["first", "second"]);

    const frames = getTopLevelFrames();

    expect(frames.map((f) => f.id)).toEqual(["second", "first"]);
  });
});
