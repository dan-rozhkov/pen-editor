import { describe, it, expect } from "vitest";
import { Container, Sprite, Texture } from "pixi.js";
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

  describe("clip-mask ownership (regression: applySiblingMasks must not steal frameRenderer's clip mask)", () => {
    function withOwnClip(container: Container): Container {
      const clip = new Container();
      clip.label = "frame-mask";
      container.addChild(clip);
      container.mask = clip;
      return clip;
    }

    it("preserves a frame's own clip mask when no sibling masker applies", () => {
      const nodesById = { a: rectNode("a"), b: rectNode("b") };
      const containers = makeContainers(["a", "b"]);
      const ownClip = withOwnClip(containers.get("a")!);

      applySiblingMasks(["a", "b"], nodesById, (id) => containers.get(id));

      expect(containers.get("a")!.mask).toBe(ownClip);
    });

    it("restores the clip mask (instead of leaving it null) after a sibling masker that used to apply is removed", () => {
      const nodesById: Record<string, FlatSceneNode> = {
        maskShape: rectNode("maskShape", { isMask: true }),
        a: rectNode("a"),
      };
      const containers = makeContainers(["maskShape", "a"]);
      const ownClip = withOwnClip(containers.get("a")!);

      // First resolution: sibling mask wins over the clip mask.
      applySiblingMasks(["maskShape", "a"], nodesById, (id) => containers.get(id));
      expect(containers.get("a")!.mask).toBe(containers.get("maskShape"));

      // isMask turned off — the clip mask must come back, not `null`.
      nodesById.maskShape = rectNode("maskShape", { isMask: false });
      applySiblingMasks(["maskShape", "a"], nodesById, (id) => containers.get(id));
      expect(containers.get("a")!.mask).toBe(ownClip);
    });

    it("gives the sibling masker precedence over a clip mask when both apply (documented precedence)", () => {
      const nodesById = {
        maskShape: rectNode("maskShape", { isMask: true }),
        a: rectNode("a"),
      };
      const containers = makeContainers(["maskShape", "a"]);
      withOwnClip(containers.get("a")!);

      applySiblingMasks(["maskShape", "a"], nodesById, (id) => containers.get(id));

      expect(containers.get("a")!.mask).toBe(containers.get("maskShape"));
    });
  });

  describe("true per-pixel alpha masking for image-fill maskers", () => {
    it("uses the masker's own 'image-fill' Sprite child as the mask target, not its wrapping container", () => {
      const nodesById: Record<string, FlatSceneNode> = {
        maskShape: rectNode("maskShape", {
          isMask: true,
          fills: [{ id: "p1", type: "image", image: { url: "https://x/y.png", mode: "fill" } }],
        }),
        a: rectNode("a"),
      };
      const containers = makeContainers(["maskShape", "a"]);
      const maskerContainer = containers.get("maskShape")!;
      const imageSprite = new Sprite(Texture.EMPTY);
      imageSprite.label = "image-fill";
      maskerContainer.addChild(imageSprite);

      applySiblingMasks(["maskShape", "a"], nodesById, (id) => containers.get(id));

      expect(containers.get("a")!.mask).toBe(imageSprite);
      expect(containers.get("a")!.mask).not.toBe(maskerContainer);
    });

    it("falls back to the masker's container when it has no 'image-fill' Sprite child (e.g. text maskers)", () => {
      const nodesById: Record<string, FlatSceneNode> = {
        maskShape: rectNode("maskShape", { isMask: true, type: "text", text: "hi" } as Partial<FlatSceneNode>),
        a: rectNode("a"),
      };
      const containers = makeContainers(["maskShape", "a"]);

      applySiblingMasks(["maskShape", "a"], nodesById, (id) => containers.get(id));

      expect(containers.get("a")!.mask).toBe(containers.get("maskShape"));
    });

    it("uses the masker's container directly for a vector (non-alpha) masker even if it happens to have an 'image-fill'-labeled child", () => {
      const nodesById: Record<string, FlatSceneNode> = {
        maskShape: rectNode("maskShape", { isMask: true }), // no image fill -> vector mode
        a: rectNode("a"),
      };
      const containers = makeContainers(["maskShape", "a"]);
      const maskerContainer = containers.get("maskShape")!;
      const decoy = new Sprite(Texture.EMPTY);
      decoy.label = "image-fill";
      maskerContainer.addChild(decoy);

      applySiblingMasks(["maskShape", "a"], nodesById, (id) => containers.get(id));

      expect(containers.get("a")!.mask).toBe(maskerContainer);
    });
  });

  describe("host-tracked fast path (perf)", () => {
    it("is a true no-op (does not even call getContainer) for a host that never had an active masker", () => {
      const nodesById = { a: rectNode("a"), b: rectNode("b") };
      const host = new Container();
      let calls = 0;
      applySiblingMasks(["a", "b"], nodesById, () => {
        calls++;
        return undefined;
      }, host);
      expect(calls).toBe(0);
    });

    it("still cleans up a host that previously had an active masker, once", () => {
      const nodesById: Record<string, FlatSceneNode> = {
        maskShape: rectNode("maskShape", { isMask: true }),
        a: rectNode("a"),
      };
      const containers = makeContainers(["maskShape", "a"]);
      const host = new Container();
      applySiblingMasks(["maskShape", "a"], nodesById, (id) => containers.get(id), host);
      expect(containers.get("a")!.mask).toBe(containers.get("maskShape"));

      nodesById.maskShape = rectNode("maskShape", { isMask: false });
      applySiblingMasks(["maskShape", "a"], nodesById, (id) => containers.get(id), host);
      expect(containers.get("a")!.mask).toBeFalsy();

      // A subsequent no-masker call for the same host is now a true no-op again.
      let calls = 0;
      applySiblingMasks(["maskShape", "a"], nodesById, (id) => {
        calls++;
        return containers.get(id);
      }, host);
      expect(calls).toBe(0);
    });
  });
});
