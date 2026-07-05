import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useSceneStore } from "@/store/sceneStore";
import { resetStores, seedScene } from "@/test/fixtures";
import { createImagePaint } from "@/utils/fillUtils";
import type { ImagePaint } from "@/types/scene";

// Inference is WASM/WebGL — not runnable in Vitest. Mock the small interface
// the handler depends on instead of the real onnxruntime-web pipeline.
const removeBackgroundMock = vi.fn();
const blobToDataUrlMock = vi.fn();
vi.mock("@/lib/backgroundRemoval", () => ({
  removeBackground: (...args: unknown[]) => removeBackgroundMock(...args),
  blobToDataUrl: (...args: unknown[]) => blobToDataUrlMock(...args),
}));

const { removeBackgroundTool } = await import("@/lib/tools/removeBackground");

beforeEach(() => {
  resetStores();
  seedScene();
  removeBackgroundMock.mockReset();
  blobToDataUrlMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function seedImageFill(nodeId: string, url = "https://cdn/original.png") {
  const node = useSceneStore.getState().nodesById[nodeId];
  useSceneStore.getState().updateNode(nodeId, {
    fills: [...(node?.fills ?? []), createImagePaint({ url, mode: "fit" })],
  });
}

describe("remove_background", () => {
  it("replaces the image fill's url with the background-removed result", async () => {
    seedImageFill("rect1");
    const fakeBlob = new Blob(["png-bytes"], { type: "image/png" });
    removeBackgroundMock.mockResolvedValue(fakeBlob);
    blobToDataUrlMock.mockResolvedValue("data:image/png;base64,RESULT");

    const result = JSON.parse(await removeBackgroundTool({ nodeId: "rect1" }));
    expect(result.success).toBe(true);
    expect(removeBackgroundMock).toHaveBeenCalledWith("https://cdn/original.png");

    const node = useSceneStore.getState().nodesById["rect1"];
    const fills = (node as unknown as { fills: ImagePaint[] }).fills;
    expect(fills).toHaveLength(1);
    expect(fills[0].image.url).toBe("data:image/png;base64,RESULT");
    // fit mode preserved
    expect(fills[0].image.mode).toBe("fit");
  });

  it("preserves other paints in the stack and only touches the image paint", async () => {
    seedImageFill("rect1");
    useSceneStore.getState().updateNode("rect1", {
      fills: [
        { id: "solid1", type: "solid", color: "#123456" },
        ...(useSceneStore.getState().nodesById["rect1"]?.fills ?? []),
      ] as never,
    });
    removeBackgroundMock.mockResolvedValue(new Blob(["x"]));
    blobToDataUrlMock.mockResolvedValue("data:image/png;base64,RESULT");

    await removeBackgroundTool({ nodeId: "rect1" });

    const node = useSceneStore.getState().nodesById["rect1"];
    const fills = (node as unknown as { fills: (ImagePaint & { color?: string })[] }).fills;
    expect(fills).toHaveLength(2);
    expect(fills[0].color).toBe("#123456");
    expect(fills[1].image.url).toBe("data:image/png;base64,RESULT");
  });

  it("returns an error when the node does not exist", async () => {
    const result = JSON.parse(await removeBackgroundTool({ nodeId: "nope" }));
    expect(result.error).toBeTruthy();
    expect(removeBackgroundMock).not.toHaveBeenCalled();
  });

  it("returns an error when the node has no image fill", async () => {
    const result = JSON.parse(await removeBackgroundTool({ nodeId: "rect1" }));
    expect(result.error).toBeTruthy();
    expect(removeBackgroundMock).not.toHaveBeenCalled();
  });

  it("returns an error and does not mutate the node when inference fails", async () => {
    seedImageFill("rect1");
    removeBackgroundMock.mockRejectedValue(
      new Error("Background removal model could not be downloaded."),
    );
    const before = JSON.stringify(useSceneStore.getState().nodesById["rect1"]);

    const result = JSON.parse(await removeBackgroundTool({ nodeId: "rect1" }));
    expect(result.error).toBe("Background removal model could not be downloaded.");
    expect(JSON.stringify(useSceneStore.getState().nodesById["rect1"])).toBe(before);
  });
});
