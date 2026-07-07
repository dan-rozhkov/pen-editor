import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import { applySiblingMasks } from "../maskHelpers";
import type { FlatSceneNode } from "@/types/scene";

function rectNode(id: string, overrides: Partial<FlatSceneNode> = {}): FlatSceneNode {
  return { id, type: "rect", x: 0, y: 0, width: 10, height: 10, ...overrides } as FlatSceneNode;
}

function makeContainers(ids: string[]): Map<string, Container> {
  const map = new Map<string, Container>();
  for (const id of ids) {
    const c = new Container();
    c.label = id;
    map.set(id, c);
  }
  return map;
}

describe("applySiblingMasks", () => {
  it("clips siblings above the masker, leaving the masker's own renderable alone", () => {
    // The masker's container must stay renderable=true here: PixiJS's own
    // StencilMask/AlphaMask effect (assigned via `.mask =`) is what excludes
    // an active mask object from normal rendering (via `includeInBuild`);
    // forcing `renderable = false` ourselves would instead short-circuit
    // Pixi's `collectRenderables` entry point and silently break the mask
    // render pass for every sibling using it (see the function's doc comment).
    const nodesById = {
      maskShape: rectNode("maskShape", { isMask: true }),
      a: rectNode("a"),
      b: rectNode("b"),
    };
    const containers = makeContainers(["maskShape", "a", "b"]);
    applySiblingMasks(["maskShape", "a", "b"], nodesById, (id) => containers.get(id));

    expect(containers.get("maskShape")!.renderable).toBe(true);
    expect(containers.get("a")!.mask).toBe(containers.get("maskShape"));
    expect(containers.get("b")!.mask).toBe(containers.get("maskShape"));
  });

  it("does not affect a sibling below the masker", () => {
    const nodesById = {
      below: rectNode("below"),
      maskShape: rectNode("maskShape", { isMask: true }),
    };
    const containers = makeContainers(["below", "maskShape"]);
    applySiblingMasks(["below", "maskShape"], nodesById, (id) => containers.get(id));

    expect(containers.get("below")!.mask).toBeFalsy();
    expect(containers.get("below")!.renderable).toBe(true);
  });

  it("hides an inert masker (nothing above it to clip) since it is never assigned as anyone's mask", () => {
    const nodesById = {
      a: rectNode("a"),
      maskShape: rectNode("maskShape", { isMask: true }),
    };
    const containers = makeContainers(["a", "maskShape"]);
    applySiblingMasks(["a", "maskShape"], nodesById, (id) => containers.get(id));

    expect(containers.get("maskShape")!.renderable).toBe(false);
    expect(containers.get("a")!.mask).toBeFalsy();
  });

  it("restores normal rendering when isMask is toggled off", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      maskShape: rectNode("maskShape", { isMask: true }),
      a: rectNode("a"),
    };
    const containers = makeContainers(["maskShape", "a"]);
    applySiblingMasks(["maskShape", "a"], nodesById, (id) => containers.get(id));
    expect(containers.get("a")!.mask).toBe(containers.get("maskShape"));

    // Flip isMask off and re-resolve.
    nodesById.maskShape = rectNode("maskShape", { isMask: false });
    applySiblingMasks(["maskShape", "a"], nodesById, (id) => containers.get(id));

    expect(containers.get("maskShape")!.renderable).toBe(true);
    expect(containers.get("a")!.mask).toBeFalsy();
  });

  it("skips missing containers without throwing", () => {
    const nodesById = { a: rectNode("a", { isMask: true }), b: rectNode("b") };
    const containers = makeContainers(["b"]);
    expect(() =>
      applySiblingMasks(["a", "b"], nodesById, (id) => containers.get(id)),
    ).not.toThrow();
    expect(containers.get("b")!.mask).toBeFalsy();
  });
});
