import { beforeEach, describe, expect, it, vi } from "vitest";

const captureLayers = vi.fn();
vi.mock("@/pixi/layers3d/captureLayers", () => ({
  MAX_PLANES: 300,
  captureLayers: (id: string) => captureLayers(id),
}));

import { useRenderModeStore } from "@/store/renderModeStore";
import { useLayers3DStore } from "@/store/layers3dStore";

describe("renderModeStore", () => {
  beforeEach(() => {
    captureLayers.mockReset();
    vi.stubGlobal("URL", { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() });
    useRenderModeStore.setState({ renderMode: "normal" });
    useLayers3DStore.setState({ active: false, targetFrameId: null, planes: [] });
  });

  it("starts in normal mode", () => {
    expect(useRenderModeStore.getState().renderMode).toBe("normal");
  });

  it("toggle flips from normal to outline", () => {
    useRenderModeStore.getState().toggle();
    expect(useRenderModeStore.getState().renderMode).toBe("outline");
  });

  it("toggle flips from outline back to normal", () => {
    useRenderModeStore.setState({ renderMode: "outline" });
    useRenderModeStore.getState().toggle();
    expect(useRenderModeStore.getState().renderMode).toBe("normal");
  });

  it("setRenderMode sets the mode directly", () => {
    useRenderModeStore.getState().setRenderMode("outline");
    expect(useRenderModeStore.getState().renderMode).toBe("outline");
    useRenderModeStore.getState().setRenderMode("normal");
    expect(useRenderModeStore.getState().renderMode).toBe("normal");
  });

  it("entering outline mode exits an active 3D layer view", () => {
    useLayers3DStore.setState({ active: true, targetFrameId: "frame1", planes: [] });
    useRenderModeStore.getState().setRenderMode("outline");
    expect(useLayers3DStore.getState().active).toBe(false);
  });

  it("toggling into outline mode exits an active 3D layer view", () => {
    useLayers3DStore.setState({ active: true, targetFrameId: "frame1", planes: [] });
    useRenderModeStore.getState().toggle();
    expect(useRenderModeStore.getState().renderMode).toBe("outline");
    expect(useLayers3DStore.getState().active).toBe(false);
  });

  it("entering 3D layer view exits outline mode", async () => {
    captureLayers.mockResolvedValue([]);
    useRenderModeStore.getState().setRenderMode("outline");
    await useLayers3DStore.getState().enter("frame1");
    expect(useRenderModeStore.getState().renderMode).toBe("normal");
  });
});
