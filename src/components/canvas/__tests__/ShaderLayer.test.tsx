import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { ShaderLayer } from "../ShaderLayer";
import { useSceneStore } from "@/store/sceneStore";
import { resetStores } from "@/test/fixtures";
import type { FlatSceneNode, ShaderConfig } from "@/types/scene";

// Replace the real (WebGL) shader components with a plain marker div.
vi.mock("@/lib/shaders/registry", () => {
  const Fake = () => <div data-fake-shader />;
  return {
    SHADER_REGISTRY: {
      meshGradient: {
        kind: "meshGradient", label: "Mesh", category: "fill",
        Component: Fake, presets: [{ name: "default", params: {} }], params: [],
      },
    },
    SHADER_KINDS: ["meshGradient"],
    defaultShaderConfig: () => ({ kind: "meshGradient", preset: "default", params: {} }),
  };
});
vi.mock("@/lib/shaders/nodeRaster", () => ({ extractNodeImage: vi.fn().mockResolvedValue(null) }));

function seedRect(shader?: ShaderConfig): void {
  useSceneStore.setState({
    nodesById: {
      r1: { id: "r1", type: "rect", x: 0, y: 0, width: 100, height: 80, shader } as unknown as FlatSceneNode,
    },
    parentById: { r1: null },
    childrenById: {},
    rootIds: ["r1"],
    componentArtifactsById: {},
    _cachedTree: null,
  });
}

describe("<ShaderLayer />", () => {
  beforeEach(() => resetStores());
  afterEach(() => cleanup());

  it("renders no hosts when no node has a shader", () => {
    seedRect(undefined);
    const { container } = render(<ShaderLayer />);
    expect(container.querySelectorAll("[data-shader-id]").length).toBe(0);
  });

  it("renders a host with the shader component for a shader-bearing node", () => {
    seedRect({ kind: "meshGradient", preset: "default", params: {} });
    const { container } = render(<ShaderLayer />);
    expect(container.querySelector('[data-shader-id="r1"]')).toBeTruthy();
    expect(container.querySelector("[data-fake-shader]")).toBeTruthy();
  });

  it("drops the host when the shader is cleared", () => {
    seedRect({ kind: "meshGradient", preset: "default", params: {} });
    const { container } = render(<ShaderLayer />);
    expect(container.querySelector('[data-shader-id="r1"]')).toBeTruthy();
    act(() => { useSceneStore.getState().updateNode("r1", { shader: undefined }); });
    expect(container.querySelector('[data-shader-id="r1"]')).toBeNull();
  });
});
