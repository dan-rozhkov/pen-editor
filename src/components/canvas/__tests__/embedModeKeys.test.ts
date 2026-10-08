import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetStores } from "@/test/fixtures";
import { useSceneStore } from "@/store/sceneStore";
import { useThemeStore } from "@/store/themeStore";
import { consumeDirty } from "@/store/sceneStore/dirtyTracking";
import type { FlatSceneNode } from "@/types/scene";
import { getEmbedModeRecomputeCount, subscribeEmbedModeKey } from "../embedModeKeys";

const node = (id: string, type: string, extra: Record<string, unknown> = {}) =>
  ({ id, type, x: 0, y: 0, width: 10, height: 10, ...extra }) as unknown as FlatSceneNode;

let unsubs: Array<() => void> = [];
const track = (u: () => void) => {
  unsubs.push(u);
  return u;
};

beforeEach(() => {
  resetStores();
  useSceneStore.setState({
    nodesById: {
      f: node("f", "frame"),
      e1: node("e1", "embed"),
      e2: node("e2", "embed"),
      other: node("other", "rect"),
      dark: node("dark", "frame", { modeOverrides: { theme: "dark" } }),
    },
    parentById: { f: null, e1: "f", e2: "dark", other: null, dark: null },
    childrenById: { f: ["e1"], dark: ["e2"] },
    rootIds: ["f", "other", "dark"],
    _cachedTree: null,
  });
  consumeDirty();
});

afterEach(() => {
  unsubs.forEach((u) => u());
  unsubs = [];
});

describe("subscribeEmbedModeKey (shared subscriber)", () => {
  it("does no recompute for a position-only change of an unrelated node", () => {
    const onChange = vi.fn();
    track(subscribeEmbedModeKey("e1", onChange));
    track(subscribeEmbedModeKey("e2", onChange));
    const before = getEmbedModeRecomputeCount();
    useSceneStore.getState().updateNode("other", { x: 50, y: 20 });
    useSceneStore.getState().updateNode("f", { x: 5 }); // a frame, but its overrides are unchanged
    expect(getEmbedModeRecomputeCount()).toBe(before);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("notifies only the embeds whose key changed when a frame's overrides change", () => {
    const a = vi.fn();
    const b = vi.fn();
    track(subscribeEmbedModeKey("e1", a));
    track(subscribeEmbedModeKey("e2", b));
    useSceneStore.getState().updateNode("f", { modeOverrides: { theme: "dark" } } as never);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it("notifies when an embed is reparented under a frame with other overrides", () => {
    const a = vi.fn();
    track(subscribeEmbedModeKey("e1", a));
    useSceneStore.getState().moveNode("e1", "dark", 0);
    expect(a).toHaveBeenCalledTimes(1);
  });

  it("notifies on a document-level mode change, and stops after unsubscribe", () => {
    const a = vi.fn();
    const unsub = subscribeEmbedModeKey("e1", a);
    useThemeStore.getState().setModeContext({ theme: "dark" });
    expect(a).toHaveBeenCalledTimes(1);
    unsub();
    useThemeStore.getState().setModeContext({ theme: "light" });
    expect(a).toHaveBeenCalledTimes(1);
  });
});
