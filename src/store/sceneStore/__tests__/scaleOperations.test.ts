import { describe, it, expect, beforeEach } from "vitest";
import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";
import { resetStores, seedScene } from "@/test/fixtures";
import type { FlatFrameNode, RectNode, TextNode } from "@/types/scene";
import { computeScaleUpdates } from "@/store/sceneStore/scaleOperations";

function scene() {
  return useSceneStore.getState();
}

function pastLen() {
  return useHistoryStore.getState().past.length;
}

/**
 * seedScene tree (see fixtures.ts):
 *   frame1 "Screen" (100,100 400x300, layout gap 8 / padding 16 all sides)
 *     ├─ rect1 "Box"   (10,20 100x50, strokeWidth 1, cornerRadius 4)
 *     └─ text1 "Title" (10,90 80x20, fontSize 16)
 *   rect2 "Floating" (600,100 200x100)
 */

describe("scaleOperations", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
  });

  describe("computeScaleUpdates (pure)", () => {
    it("scales a subtree root and every descendant's geometry by the same factor", () => {
      const s = scene();
      const updates = computeScaleUpdates(["frame1"], 2, s.nodesById, s.childrenById);

      expect(updates.frame1.width).toBe(800);
      expect(updates.frame1.height).toBe(600);
      // root x/y scale from the default {0,0} anchor
      expect(updates.frame1.x).toBe(200);
      expect(updates.frame1.y).toBe(200);

      // descendants are relative to frame1's own origin — scaled directly,
      // no extra offset from frame1's own position change (that's the
      // double-scaling trap the recursive walk must avoid).
      expect(updates.rect1.x).toBe(20);
      expect(updates.rect1.y).toBe(40);
      expect(updates.rect1.width).toBe(200);
      expect(updates.rect1.height).toBe(100);

      expect(updates.text1.x).toBe(20);
      expect(updates.text1.y).toBe(180);
    });

    it("scales the root from an explicit base size (effective layout size), not the stale stored size", () => {
      const s = scene();
      // Simulate a fill_container / fit_content node: stored width 100 but the
      // gesture was measured against an effective width of 250 (what yoga
      // computed / what the handles were drawn at). The committed size must
      // match the base the gesture used, and the anchored edge must stay put.
      useSceneStore.setState((state) => ({
        nodesById: {
          ...state.nodesById,
          rect2: { ...state.nodesById.rect2, x: 0, y: 0, width: 100, height: 100 },
        },
      }));
      const s2 = scene();
      // Anchor at the node's right/bottom edge in local space, derived from the
      // effective base size (0 + 250 = 250), so the right edge should stay fixed.
      const updates = computeScaleUpdates(
        ["rect2"],
        2,
        s2.nodesById,
        s2.childrenById,
        { rect2: { x: 250, y: 250 } },
        { rect2: { width: 250, height: 250 } },
      );
      expect(updates.rect2.width).toBe(500); // 250 (effective base) * 2, NOT 100 * 2
      expect(updates.rect2.height).toBe(500);
      // right edge coherence: x' + width' stays at the anchored 250
      expect((updates.rect2.x as number) + (updates.rect2.width as number)).toBe(250);
      void s;
    });

    it("dedupes overlapping roots: a descendant listed as its own root is scaled once, as a descendant", () => {
      const s = scene();
      // frame1 + its child rect1, with a bogus anchor attached to rect1-as-root.
      // Without dedupe, rect1 would also be patched from anchor {1000,1000}
      // (=> x -980); with dedupe it is scaled only as frame1's descendant
      // (anchor {0,0} => x 20).
      const updates = computeScaleUpdates(
        ["frame1", "rect1"],
        2,
        s.nodesById,
        s.childrenById,
        { rect1: { x: 1000, y: 1000 } },
      );
      expect(updates.rect1.x).toBe(20);
      expect(updates.rect1.y).toBe(40);
      expect(updates.rect1.width).toBe(200);
    });

    it("honors an explicit anchor for the root only, leaving descendants anchored at {0,0}", () => {
      const s = scene();
      // Anchor at frame1's own top-left (100,100 in ITS parent's space —
      // frame1 is a root node so its "parent space" is the canvas root).
      const updates = computeScaleUpdates(
        ["frame1"],
        2,
        s.nodesById,
        s.childrenById,
        { frame1: { x: 100, y: 100 } },
      );
      // Anchored scale: x stays put (100 + (100-100)*2 = 100).
      expect(updates.frame1.x).toBe(100);
      expect(updates.frame1.y).toBe(100);
      expect(updates.frame1.width).toBe(800);
      // Descendant positions are untouched by the root's anchor.
      expect(updates.rect1.x).toBe(20);
      expect(updates.rect1.y).toBe(40);
    });
  });

  describe("scaleNodes (store action)", () => {
    it("2x-scales a frame containing a text node and a stroked/rounded rect, doubling all relevant props", () => {
      scene().scaleNodes(["frame1"], 2);
      const s = scene();

      const frame1 = s.nodesById.frame1 as FlatFrameNode;
      expect(frame1.width).toBe(800);
      expect(frame1.height).toBe(600);
      expect(frame1.layout?.gap).toBe(16);
      expect(frame1.layout?.paddingTop).toBe(32);
      expect(frame1.layout?.paddingRight).toBe(32);
      expect(frame1.layout?.paddingBottom).toBe(32);
      expect(frame1.layout?.paddingLeft).toBe(32);
      // auto-layout mode itself must be preserved, not converted.
      expect(frame1.layout?.autoLayout).toBe(false);

      const rect1 = s.nodesById.rect1 as RectNode;
      expect(rect1.width).toBe(200);
      expect(rect1.height).toBe(100);
      expect(rect1.strokeWidth).toBe(2);
      expect(rect1.cornerRadius).toBe(8);

      const text1 = s.nodesById.text1 as TextNode;
      expect(text1.width).toBe(160);
      expect(text1.height).toBe(40);
      expect(text1.fontSize).toBe(32);

      // Sibling outside the scaled subtree is untouched.
      expect(s.nodesById.rect2.width).toBe(200);
    });

    it("records exactly one history entry for the whole subtree", () => {
      const before = pastLen();
      scene().scaleNodes(["frame1"], 2);
      expect(pastLen()).toBe(before + 1);
    });

    it("undoes the whole scale (root + all descendants) in one step", () => {
      const originalFrame = { ...scene().nodesById.frame1 };
      const originalRect = { ...scene().nodesById.rect1 };
      const originalText = { ...scene().nodesById.text1 };

      scene().scaleNodes(["frame1"], 2);
      expect(scene().nodesById.rect1.width).toBe(200);

      const undone = useHistoryStore.getState().undo(createSnapshot(scene()));
      expect(undone).toBeTruthy();
      scene().restoreSnapshot(undone!);

      const s = scene();
      expect(s.nodesById.frame1.width).toBe(originalFrame.width);
      expect(s.nodesById.frame1.height).toBe(originalFrame.height);
      expect(s.nodesById.rect1.width).toBe(originalRect.width);
      expect(s.nodesById.rect1.x).toBe(originalRect.x);
      expect(s.nodesById.text1.width).toBe(originalText.width);
    });

    it("scales an auto-layout frame's gap/padding while preserving fixed/hug sizing modes", () => {
      useSceneStore.setState((state) => ({
        nodesById: {
          ...state.nodesById,
          frame1: {
            ...state.nodesById.frame1,
            layout: { autoLayout: true, flexDirection: "column", gap: 10, paddingTop: 20, paddingLeft: 20 },
            sizing: { widthMode: "fit_content", heightMode: "fixed" },
          } as FlatFrameNode,
        },
      }));

      scene().scaleNodes(["frame1"], 3);
      const frame1 = scene().nodesById.frame1 as FlatFrameNode;
      expect(frame1.layout?.gap).toBe(30);
      expect(frame1.layout?.paddingTop).toBe(60);
      expect(frame1.layout?.paddingLeft).toBe(60);
      expect(frame1.layout?.autoLayout).toBe(true);
      expect(frame1.sizing?.widthMode).toBe("fit_content");
      expect(frame1.sizing?.heightMode).toBe("fixed");
    });

    it("no-ops for an empty id list or non-positive factor", () => {
      const before = pastLen();
      scene().scaleNodes([], 2);
      scene().scaleNodes(["frame1"], 0);
      scene().scaleNodes(["frame1"], -1);
      expect(pastLen()).toBe(before);
      expect(scene().nodesById.frame1.width).toBe(400);
    });
  });
});
