import { beforeEach, describe, expect, it, vi } from "vitest";

const captureLayers = vi.fn();
vi.mock("@/pixi/layers3d/captureLayers", () => ({
  MAX_PLANES: 300,
  captureLayers: (id: string) => captureLayers(id),
}));

import {
  useLayers3DStore,
  DEFAULT_ROTATE_X,
  DEFAULT_ROTATE_Y,
  DEFAULT_SPACING,
  ROTATE_CLAMP,
  MAX_SPACING,
} from "@/store/layers3dStore";

const revoke = vi.fn();

describe("layers3dStore", () => {
  beforeEach(() => {
    captureLayers.mockReset();
    revoke.mockReset();
    vi.stubGlobal("URL", { createObjectURL: vi.fn(), revokeObjectURL: revoke });
    useLayers3DStore.setState({
      active: false,
      targetFrameId: null,
      planes: [],
      rotateX: DEFAULT_ROTATE_X,
      rotateY: DEFAULT_ROTATE_Y,
      spacing: DEFAULT_SPACING,
      zoom: 1,
      hoveredPlaneId: null,
    });
  });

  it("enter captures planes and activates with default view", async () => {
    captureLayers.mockResolvedValue([
      { nodeId: "a", depthIndex: 0, imageUrl: "blob:a", rect: {}, cornerRadius: 0 },
    ]);
    await useLayers3DStore.getState().enter("frame1");
    const s = useLayers3DStore.getState();
    expect(s.active).toBe(true);
    expect(s.targetFrameId).toBe("frame1");
    expect(s.planes).toHaveLength(1);
    expect(s.rotateX).toBe(DEFAULT_ROTATE_X);
    expect(s.rotateY).toBe(DEFAULT_ROTATE_Y);
  });

  it("exit revokes every plane object-URL and deactivates", () => {
    useLayers3DStore.setState({
      active: true,
      planes: [
        { nodeId: "a", depthIndex: 0, imageUrl: "blob:a", rect: {}, cornerRadius: 0 },
        { nodeId: "b", depthIndex: 1, imageUrl: "blob:b", rect: {}, cornerRadius: 0 },
      ] as never,
    });
    useLayers3DStore.getState().exit();
    expect(revoke).toHaveBeenCalledWith("blob:a");
    expect(revoke).toHaveBeenCalledWith("blob:b");
    expect(useLayers3DStore.getState().active).toBe(false);
    expect(useLayers3DStore.getState().planes).toEqual([]);
  });

  it("exits cleanly if captureLayers rejects instead of stranding the view active", async () => {
    captureLayers.mockRejectedValue(new Error("extract failed"));
    await useLayers3DStore.getState().enter("frame1");
    const s = useLayers3DStore.getState();
    expect(s.active).toBe(false);
    expect(s.targetFrameId).toBeNull();
    expect(s.planes).toEqual([]);
  });

  it("clamps rotation, spacing and zoom", () => {
    const st = useLayers3DStore.getState();
    st.setRotation(999, -999);
    expect(useLayers3DStore.getState().rotateX).toBe(ROTATE_CLAMP);
    expect(useLayers3DStore.getState().rotateY).toBe(-ROTATE_CLAMP);
    st.setSpacing(9999);
    expect(useLayers3DStore.getState().spacing).toBe(MAX_SPACING);
    st.setZoom(999);
    expect(useLayers3DStore.getState().zoom).toBe(3);
  });
});
