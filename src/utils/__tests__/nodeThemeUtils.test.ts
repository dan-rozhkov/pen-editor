import { describe, it, expect, beforeEach } from "vitest";
import { getEffectiveThemeForNode } from "@/utils/nodeThemeUtils";
import { useSceneStore } from "@/store/sceneStore";
import { useThemeStore } from "@/store/themeStore";
import { resetStores } from "@/test/fixtures";
import type { FlatSceneNode } from "@/types/scene";

describe("getEffectiveThemeForNode", () => {
  beforeEach(() => resetStores());

  it("returns the global active theme when no ancestor frame overrides it", () => {
    useThemeStore.setState({ activeTheme: "light" });
    useSceneStore.setState({
      nodesById: {
        e1: { id: "e1", type: "embed", htmlContent: "", x: 0, y: 0, width: 10, height: 10 } as unknown as FlatSceneNode,
      },
      parentById: { e1: null },
      childrenById: {},
      rootIds: ["e1"],
      componentArtifactsById: {},
      _cachedTree: null,
    });
    expect(getEffectiveThemeForNode("e1")).toBe("light");
  });

  it("returns an ancestor frame's themeOverride", () => {
    useThemeStore.setState({ activeTheme: "light" });
    useSceneStore.setState({
      nodesById: {
        f1: { id: "f1", type: "frame", themeOverride: "dark", x: 0, y: 0, width: 100, height: 100 } as unknown as FlatSceneNode,
        e1: { id: "e1", type: "embed", htmlContent: "", x: 0, y: 0, width: 10, height: 10 } as unknown as FlatSceneNode,
      },
      parentById: { f1: null, e1: "f1" },
      childrenById: { f1: ["e1"] },
      rootIds: ["f1"],
      componentArtifactsById: {},
      _cachedTree: null,
    });
    expect(getEffectiveThemeForNode("e1")).toBe("dark");
  });
});
