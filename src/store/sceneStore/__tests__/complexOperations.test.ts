import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";
import { resetStores, seedScene } from "@/test/fixtures";
import type { FlatFrameNode, EmbedNode, FlatSceneNode, TextNode } from "@/types/scene";
import type { H2dDocument } from "@/lib/h2dPaste/h2dTypes";
import { buildDocument, el, rect, text } from "@/lib/h2dPaste/__tests__/h2dFixture";

const CAPTURE_FIXTURE: H2dDocument = buildDocument(
  el(
    "BODY",
    rect(0, 0, 400, 300),
    { backgroundColor: "rgb(245, 240, 230)" },
    [
      el(
        "DIV",
        rect(20, 200, 80, 60),
        {
          backgroundImage:
            "linear-gradient(180deg, rgb(253, 230, 138) 0%, rgb(251, 191, 36) 100%)",
        },
      ),
      el(
        "DIV",
        rect(20, 160, 80, 20),
        {
          fontFamily: '"Plus Jakarta Sans", sans-serif',
          fontSize: "16px",
          color: "rgb(26, 26, 46)",
        },
        [text("10,1", rect(20, 160, 40, 20))],
      ),
    ],
  ),
  { documentTitle: "fixture" },
);

vi.mock("@/lib/h2dCapture/captureEmbed", () => ({
  captureEmbedHtmlToH2d: vi.fn().mockResolvedValue(CAPTURE_FIXTURE),
}));

function scene() {
  return useSceneStore.getState();
}

function pastLen() {
  return useHistoryStore.getState().past.length;
}

// Replicate the real undo cycle from useCanvasKeyboardShortcuts: snapshot
// current -> ask history for the target -> restore it if present.
function undo() {
  const snapshot = createSnapshot(useSceneStore.getState());
  const prev = useHistoryStore.getState().undo(snapshot);
  if (prev) useSceneStore.getState().restoreSnapshot(prev);
  return prev;
}

/**
 * seedScene tree (see fixtures.ts):
 *   frame1 "Screen" (100,100 400x300)
 *     ├─ rect1 "Box"   (10,20 100x50)
 *     └─ text1 "Title" (10,90 80x20)
 *   rect2 "Floating" (600,100 200x100)
 */

describe("complexOperations", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
  });

  describe("groupNodes", () => {
    it("wraps two same-parent siblings into a group with bounding-box bounds", () => {
      const before = pastLen();
      const groupId = scene().groupNodes(["rect1", "text1"]);
      expect(groupId).toBeTruthy();

      const s = scene();
      const group = s.nodesById[groupId!] as FlatSceneNode;
      expect(group.type).toBe("group");
      // bounding box of rect1 (10,20 100x50) + text1 (10,90 80x20)
      expect(group.x).toBe(10);
      expect(group.y).toBe(20);
      expect(group.width).toBe(100); // maxX 110 - minX 10
      expect(group.height).toBe(90); // maxY 110 - minY 20

      // group reparented under frame1, replacing its children at index 0
      expect(s.parentById[groupId!]).toBe("frame1");
      expect(s.childrenById["frame1"]).toEqual([groupId]);
      expect(s.childrenById[groupId!]).toEqual(["rect1", "text1"]);
      expect(s.parentById["rect1"]).toBe(groupId);
      expect(s.parentById["text1"]).toBe(groupId);

      // children positions become group-local (offset by minX/minY)
      expect(s.nodesById["rect1"].x).toBe(0);
      expect(s.nodesById["rect1"].y).toBe(0);
      expect(s.nodesById["text1"].x).toBe(0);
      expect(s.nodesById["text1"].y).toBe(70);

      expect(pastLen()).toBe(before + 1);
    });

    it("groups root-level siblings and inserts the group into rootIds", () => {
      const groupId = scene().groupNodes(["frame1", "rect2"]);
      expect(groupId).toBeTruthy();

      const s = scene();
      expect(s.rootIds).toEqual([groupId]);
      expect(s.parentById[groupId!]).toBeNull();
      expect(s.parentById["frame1"]).toBe(groupId);
      expect(s.parentById["rect2"]).toBe(groupId);
      // bbox: frame1 (100,100 400x300) + rect2 (600,100 200x100)
      const group = s.nodesById[groupId!];
      expect(group.x).toBe(100);
      expect(group.y).toBe(100);
      expect(group.width).toBe(700); // 800 - 100
      expect(group.height).toBe(300); // 400 - 100
    });

    it("returns null for fewer than two ids without touching history", () => {
      const before = pastLen();
      expect(scene().groupNodes(["rect1"])).toBeNull();
      expect(scene().groupNodes([])).toBeNull();
      expect(pastLen()).toBe(before);
    });

    it("returns null when nodes do not share a parent", () => {
      const before = pastLen();
      // rect1 is under frame1, rect2 is at root
      expect(scene().groupNodes(["rect1", "rect2"])).toBeNull();
      expect(pastLen()).toBe(before);
    });

    it("returns null when an id does not exist", () => {
      expect(scene().groupNodes(["rect1", "ghost"])).toBeNull();
    });
  });

  describe("ungroupNodes", () => {
    it("dissolves a frame and re-parents children to absolute coordinates", () => {
      const before = pastLen();
      const childIds = scene().ungroupNodes(["frame1"]);
      expect(childIds).toEqual(["rect1", "text1"]);

      const s = scene();
      // frame1 removed entirely
      expect(s.nodesById["frame1"]).toBeUndefined();
      expect(s.parentById["frame1"]).toBeUndefined();
      expect(s.childrenById["frame1"]).toBeUndefined();

      // children promoted to root, replacing frame1 in place
      expect(s.rootIds).toEqual(["rect1", "text1", "rect2"]);
      expect(s.parentById["rect1"]).toBeNull();
      expect(s.parentById["text1"]).toBeNull();

      // positions converted from frame-local to parent-local (child + frame origin)
      expect(s.nodesById["rect1"].x).toBe(110); // 10 + 100
      expect(s.nodesById["rect1"].y).toBe(120); // 20 + 100
      expect(s.nodesById["text1"].x).toBe(110); // 10 + 100
      expect(s.nodesById["text1"].y).toBe(190); // 90 + 100

      expect(pastLen()).toBe(before + 1);
    });

    it("round-trips group -> ungroup back to original positions and parent", () => {
      const groupId = scene().groupNodes(["rect1", "text1"])!;
      scene().ungroupNodes([groupId]);

      const s = scene();
      expect(s.nodesById[groupId]).toBeUndefined();
      expect(s.childrenById["frame1"]).toEqual(["rect1", "text1"]);
      expect(s.parentById["rect1"]).toBe("frame1");
      expect(s.parentById["text1"]).toBe("frame1");
      // original seedScene coordinates restored
      expect(s.nodesById["rect1"].x).toBe(10);
      expect(s.nodesById["rect1"].y).toBe(20);
      expect(s.nodesById["text1"].x).toBe(10);
      expect(s.nodesById["text1"].y).toBe(90);
    });

    it("returns [] and skips history when nothing is ungroupable", () => {
      const before = pastLen();
      // rect2 is a plain rect, not a group/frame
      expect(scene().ungroupNodes(["rect2"])).toEqual([]);
      expect(scene().ungroupNodes(["ghost"])).toEqual([]);
      expect(pastLen()).toBe(before);
    });
  });

  describe("convertNodeType", () => {
    it("converts a frame to a group preserving identity and geometry", () => {
      const before = pastLen();
      expect(scene().convertNodeType("frame1")).toBe(true);

      const node = scene().nodesById["frame1"];
      expect(node.type).toBe("group");
      expect(node.name).toBe("Screen");
      expect(node.x).toBe(100);
      expect(node.y).toBe(100);
      expect(node.width).toBe(400);
      expect(node.height).toBe(300);
      // tree structure is untouched
      expect(scene().childrenById["frame1"]).toEqual(["rect1", "text1"]);
      expect(pastLen()).toBe(before + 1);
    });

    it("round-trips frame -> group -> frame", () => {
      expect(scene().convertNodeType("frame1")).toBe(true);
      expect(scene().nodesById["frame1"].type).toBe("group");
      expect(scene().convertNodeType("frame1")).toBe(true);
      expect(scene().nodesById["frame1"].type).toBe("frame");
    });

    it("preserves fills/effects/cornerRadius across a frame -> group -> frame round-trip", () => {
      const s = scene();
      const fills = [{ id: "fill1", type: "solid" as const, color: "#ff0000" }];
      const effects = [
        {
          type: "shadow" as const,
          shadowType: "outer" as const,
          color: "#00000040",
          offset: { x: 2, y: 2 },
          blur: 4,
          spread: 0,
        },
      ];
      s.nodesById["frame1"] = {
        ...(s.nodesById["frame1"] as FlatFrameNode),
        fills,
        effects,
        cornerRadius: 12,
      } as FlatSceneNode;
      useSceneStore.setState({ nodesById: { ...s.nodesById } });

      expect(scene().convertNodeType("frame1")).toBe(true);
      const group = scene().nodesById["frame1"] as FlatSceneNode;
      expect(group.type).toBe("group");
      expect(group.fills).toEqual(fills);
      expect(group.effects).toEqual(effects);
      expect((group as unknown as FlatFrameNode).cornerRadius).toBe(12);
      expect((group as unknown as FlatFrameNode).layout).toBeUndefined();
      expect((group as unknown as FlatFrameNode).reusable).toBeUndefined();

      expect(scene().convertNodeType("frame1")).toBe(true);
      const frame = scene().nodesById["frame1"] as FlatFrameNode;
      expect(frame.type).toBe("frame");
      expect(frame.fills).toEqual(fills);
      expect(frame.effects).toEqual(effects);
      expect(frame.cornerRadius).toBe(12);
    });

    it("refuses to convert a reusable (component) frame without pushing history", () => {
      const s = scene();
      s.nodesById["frame1"] = {
        ...(s.nodesById["frame1"] as FlatFrameNode),
        reusable: true,
      } as FlatSceneNode;
      useSceneStore.setState({ nodesById: { ...s.nodesById } });

      const before = pastLen();
      expect(scene().convertNodeType("frame1")).toBe(false);
      expect(scene().nodesById["frame1"].type).toBe("frame");
      expect(pastLen()).toBe(before);
    });

    it("returns false for a non-frame/group node and for a missing id without pushing history", () => {
      const before = pastLen();
      expect(scene().convertNodeType("rect1")).toBe(false);
      expect(scene().nodesById["rect1"].type).toBe("rect");
      expect(scene().convertNodeType("ghost")).toBe(false);
      expect(pastLen()).toBe(before);
    });
  });

  describe("wrapInAutoLayoutFrame", () => {
    it("wraps siblings into an auto-layout column frame", () => {
      const before = pastLen();
      const frameId = scene().wrapInAutoLayoutFrame(["rect1", "text1"]);
      expect(frameId).toBeTruthy();

      const s = scene();
      const frame = s.nodesById[frameId!] as FlatFrameNode;
      expect(frame.type).toBe("frame");
      expect(frame.layout?.autoLayout).toBe(true);
      expect(frame.layout?.flexDirection).toBe("column");
      // same bounding box as a group of the two
      expect(frame.x).toBe(10);
      expect(frame.y).toBe(20);
      expect(frame.width).toBe(100);
      expect(frame.height).toBe(90);

      expect(s.parentById[frameId!]).toBe("frame1");
      expect(s.childrenById["frame1"]).toEqual([frameId]);
      expect(s.childrenById[frameId!]).toEqual(["rect1", "text1"]);
      expect(pastLen()).toBe(before + 1);
    });

    it("wraps a single root node and replaces it in rootIds", () => {
      const frameId = scene().wrapInAutoLayoutFrame(["rect2"]);
      expect(frameId).toBeTruthy();

      const s = scene();
      expect(s.rootIds).toEqual(["frame1", frameId]);
      expect(s.parentById["rect2"]).toBe(frameId);
      expect(s.childrenById[frameId!]).toEqual(["rect2"]);
    });

    it("returns null for an empty id list or mixed parents", () => {
      const before = pastLen();
      expect(scene().wrapInAutoLayoutFrame([])).toBeNull();
      expect(scene().wrapInAutoLayoutFrame(["rect1", "rect2"])).toBeNull();
      expect(pastLen()).toBe(before);
    });
  });

  describe("convertDesignToEmbed", () => {
    it("replaces a frame subtree with an embed carrying generated HTML", () => {
      const before = pastLen();
      const embedId = scene().convertDesignToEmbed("frame1");
      expect(embedId).toBeTruthy();

      const s = scene();
      const embed = s.nodesById[embedId!] as EmbedNode;
      expect(embed.type).toBe("embed");
      expect(embed.name).toBe("Screen");
      expect(embed.x).toBe(100);
      expect(embed.y).toBe(100);
      expect(embed.width).toBe(400);
      expect(embed.height).toBe(300);
      expect(typeof embed.htmlContent).toBe("string");
      expect(embed.htmlContent.length).toBeGreaterThan(0);

      // original frame + descendants gone, embed put in its slot
      expect(s.nodesById["frame1"]).toBeUndefined();
      expect(s.nodesById["rect1"]).toBeUndefined();
      expect(s.nodesById["text1"]).toBeUndefined();
      expect(s.rootIds).toEqual([embedId, "rect2"]);
      expect(pastLen()).toBe(before + 1);
    });

    it("returns null for nodes that are neither frame nor group", () => {
      expect(scene().convertDesignToEmbed("rect1")).toBeNull();
      expect(scene().convertDesignToEmbed("ghost")).toBeNull();
    });
  });

  describe("convertEmbedToDesign", () => {
    function seedEmbed() {
      const embed = {
        id: "embed1",
        type: "embed",
        name: "Widget",
        x: 50,
        y: 60,
        width: 120,
        height: 80,
        htmlContent:
          '<div style="width:120px;height:80px;background:#123456"></div>',
      } as unknown as EmbedNode;
      const s = scene();
      useSceneStore.setState({
        nodesById: { ...s.nodesById, embed1: embed },
        parentById: { ...s.parentById, embed1: null },
        rootIds: [...s.rootIds, "embed1"],
        _cachedTree: null,
      });
    }

    it("replaces an embed with a converted design subtree", async () => {
      seedEmbed();
      const before = pastLen();

      const rootId = await scene().convertEmbedToDesign("embed1");
      expect(rootId).toBeTruthy();

      const s = scene();
      expect(s.nodesById["embed1"]).toBeUndefined();
      const root = s.nodesById[rootId!];
      expect(root).toBeDefined();
      // converted root keeps the embed's name and origin/size
      expect(root.name).toBe("Widget");
      expect(root.x).toBe(50);
      expect(root.y).toBe(60);
      expect((root as FlatFrameNode).width).toBe(120);
      expect((root as FlatFrameNode).height).toBe(80);
      expect((root as FlatFrameNode).clip).toBe(true);
      // embed replaced in place within rootIds
      expect(s.rootIds).toContain(rootId);
      expect(s.rootIds).not.toContain("embed1");
      expect(pastLen()).toBe(before + 1);

      // h2d fixture content made it through the pipeline
      const rootChildIds = s.childrenById[rootId!] ?? [];
      const rootChildren = rootChildIds.map((cid) => s.nodesById[cid]);

      const bar = rootChildren.find(
        (c) => c.type === "frame" && (c as FlatFrameNode).gradientFill,
      ) as FlatFrameNode | undefined;
      expect(bar).toBeDefined();
      expect(bar!.gradientFill!.type).toBe("linear");

      const textNode = rootChildren.find(
        (c) => c.type === "text",
      ) as TextNode | undefined;
      expect(textNode?.text).toBe("10,1");
      expect(textNode?.fontFamily).toBe("Plus Jakarta Sans");
      expect(textNode?.fontFallback).toBe("sans-serif");
    });

    it("undo restores the removed embed", async () => {
      seedEmbed();
      const rootId = await scene().convertEmbedToDesign("embed1");
      expect(rootId).toBeTruthy();
      expect(scene().nodesById["embed1"]).toBeUndefined();

      undo();

      const s = scene();
      expect(s.nodesById["embed1"]).toBeDefined();
      expect(s.nodesById[rootId!]).toBeUndefined();
      expect(s.rootIds).toContain("embed1");
    });

    it("returns null for non-embed and missing nodes", async () => {
      expect(await scene().convertEmbedToDesign("rect1")).toBeNull();
      expect(await scene().convertEmbedToDesign("ghost")).toBeNull();
    });
  });
});
