import { describe, it, expect, beforeEach } from "vitest";
import { batchDesign } from "@/lib/tools/batchDesign";
import { useSceneStore } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";
import { resetStores, seedScene, seedVariables } from "@/test/fixtures";
import type { FlatFrameNode, TextNode } from "@/types/scene";

function sceneState() {
  return useSceneStore.getState();
}

describe("batch_design", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
  });

  describe("insert (I)", () => {
    it("creates a root frame with layout shorthand mapped to layout props", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations:
            'card=I(document, {type: "frame", name: "Card", width: 200, height: 120, layout: "vertical", gap: 8, padding: 16, fill: "#ffffff"})',
        })
      );

      expect(result.success).toBe(true);
      expect(result.operationsExecuted).toBe(1);
      expect(result.createdNodes).toHaveLength(1);

      const created = result.createdNodes[0];
      expect(created.type).toBe("frame");
      expect(created.name).toBe("Card");

      const { nodesById, rootIds, parentById } = sceneState();
      expect(rootIds).toContain(created.id);
      expect(parentById[created.id]).toBeNull();

      const frame = nodesById[created.id] as FlatFrameNode;
      expect(frame.width).toBe(200);
      expect(frame.height).toBe(120);
      expect(frame.layout).toMatchObject({
        autoLayout: true,
        flexDirection: "column",
        gap: 8,
        paddingTop: 16,
        paddingRight: 16,
        paddingBottom: 16,
        paddingLeft: 16,
      });
    });

    it("maps the MCP type 'rectangle' to internal 'rect'", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations:
            'r=I(document, {type: "rectangle", name: "R", width: 10, height: 10})',
        })
      );
      expect(result.success).toBe(true);
      const id = result.createdNodes[0].id;
      expect(sceneState().nodesById[id].type).toBe("rect");
    });

    it("creates nested children inline and wires up the tree", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations:
            'f=I(document, {type: "frame", name: "Parent", width: 300, height: 200, children: [{type: "rectangle", name: "ChildA", width: 50, height: 50}, {type: "text", name: "ChildB", content: "Hi"}]})',
        })
      );
      expect(result.success).toBe(true);

      const parentId = result.createdNodes[0].id;
      const { nodesById, childrenById, parentById } = sceneState();
      const childIds = childrenById[parentId];
      expect(childIds).toHaveLength(2);
      expect(nodesById[childIds[0]].type).toBe("rect");
      expect(nodesById[childIds[1]].type).toBe("text");
      expect((nodesById[childIds[1]] as TextNode).text).toBe("Hi");
      expect(parentById[childIds[0]]).toBe(parentId);
      expect(parentById[childIds[1]]).toBe(parentId);
    });

    it("inserts into an existing frame referenced by raw id", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations:
            'I(frame1, {type: "ellipse", name: "Dot", width: 20, height: 20})',
        })
      );
      expect(result.success).toBe(true);
      const id = result.createdNodes[0].id;
      const { childrenById, parentById } = sceneState();
      expect(childrenById["frame1"]).toContain(id);
      expect(parentById[id]).toBe("frame1");
    });

    it("uses a binding from a previous operation as parent", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations: [
            'wrap=I(document, {type: "frame", name: "Wrap", width: 100, height: 100})',
            'I(wrap, {type: "rectangle", name: "Inner", width: 10, height: 10})',
          ].join("\n"),
        })
      );
      expect(result.success).toBe(true);
      expect(result.operationsExecuted).toBe(2);

      const wrapId = result.createdNodes[0].id;
      const innerId = result.createdNodes[1].id;
      expect(sceneState().parentById[innerId]).toBe(wrapId);
    });

    it("resolves $variable fill references to value + binding", async () => {
      seedVariables();
      const result = JSON.parse(
        await batchDesign({
          operations:
            'r=I(document, {type: "rectangle", name: "Var", width: 10, height: 10, fill: "$--primary"})',
        })
      );
      expect(result.success).toBe(true);
      const node = sceneState().nodesById[result.createdNodes[0].id] as Record<
        string,
        unknown
      >;
      expect(node.fill).toBe("#3366ff");
      expect(node.fillBinding).toEqual({ variableId: "var-primary" });
    });

    it('parses sizing strings like "fill_container"', async () => {
      const result = JSON.parse(
        await batchDesign({
          operations:
            'f=I(frame1, {type: "frame", name: "Fill", width: "fill_container", height: "fit_content"})',
        })
      );
      expect(result.success).toBe(true);
      const node = sceneState().nodesById[result.createdNodes[0].id];
      expect(node.sizing).toEqual({
        widthMode: "fill_container",
        heightMode: "fit_content",
      });
    });
  });

  describe("update (U)", () => {
    it("updates properties of an existing node", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations: 'U(rect2, {fill: "#0000ff", name: "Renamed", x: 50})',
        })
      );
      expect(result.success).toBe(true);

      const node = sceneState().nodesById["rect2"];
      expect(node.fill).toBe("#0000ff");
      expect(node.name).toBe("Renamed");
      expect(node.x).toBe(50);
      // Untouched properties survive
      expect(node.width).toBe(200);
    });

    it("merges layout updates into the existing layout object", async () => {
      const result = JSON.parse(
        await batchDesign({ operations: "U(frame1, {gap: 24})" })
      );
      expect(result.success).toBe(true);
      const frame = sceneState().nodesById["frame1"] as FlatFrameNode;
      expect(frame.layout?.gap).toBe(24);
      // Pre-existing padding from the fixture is preserved
      expect(frame.layout?.paddingTop).toBe(16);
    });

    it("re-measures text dimensions when updating a text node", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations: 'U(text1, {content: "Hello world, longer"})',
        })
      );
      expect(result.success).toBe(true);
      const text = sceneState().nodesById["text1"] as TextNode;
      expect(text.text).toBe("Hello world, longer");
      // Stubbed measurement: 8px per character
      expect(text.width).toBe("Hello world, longer".length * 8);
    });
  });

  describe("delete (D) and move (M)", () => {
    it("deletes a frame together with all descendants", async () => {
      const result = JSON.parse(
        await batchDesign({ operations: "D(frame1)" })
      );
      expect(result.success).toBe(true);

      const { nodesById, rootIds, parentById, childrenById } = sceneState();
      expect(nodesById["frame1"]).toBeUndefined();
      expect(nodesById["rect1"]).toBeUndefined();
      expect(nodesById["text1"]).toBeUndefined();
      expect(rootIds).toEqual(["rect2"]);
      expect(parentById["rect1"]).toBeUndefined();
      expect(childrenById["frame1"]).toBeUndefined();
    });

    it("moves a root node into a frame at a given index", async () => {
      const result = JSON.parse(
        await batchDesign({ operations: "M(rect2, frame1, 0)" })
      );
      expect(result.success).toBe(true);

      const { rootIds, parentById, childrenById } = sceneState();
      expect(rootIds).toEqual(["frame1"]);
      expect(parentById["rect2"]).toBe("frame1");
      expect(childrenById["frame1"]).toEqual(["rect2", "rect1", "text1"]);
    });
  });

  describe("copy (C)", () => {
    it("clones a subtree with new ids and positions it relative to the source", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations:
            'copy=C(frame1, document, {name: "Screen Copy", positionDirection: "right", positionPadding: 50})',
        })
      );
      expect(result.success).toBe(true);

      const cloneId = result.createdNodes[0].id;
      expect(cloneId).not.toBe("frame1");

      const { nodesById, childrenById, rootIds } = sceneState();
      const clone = nodesById[cloneId];
      expect(clone.name).toBe("Screen Copy");
      // right of frame1: x = 100 + 400 + 50
      expect(clone.x).toBe(550);
      expect(clone.y).toBe(100);
      expect(rootIds).toContain(cloneId);
      // children cloned with fresh ids
      expect(childrenById[cloneId]).toHaveLength(2);
      expect(childrenById[cloneId]).not.toContain("rect1");
      // original untouched
      expect(childrenById["frame1"]).toEqual(["rect1", "text1"]);
    });
  });

  describe("error handling", () => {
    it("returns an error for empty operations and leaves the store untouched", async () => {
      const before = sceneState();
      const result = JSON.parse(await batchDesign({ operations: "" }));
      expect(result.error).toBe("No operations provided");
      expect(sceneState().nodesById).toBe(before.nodesById);
    });

    it("returns a parse error for invalid syntax without mutating the store", async () => {
      const before = sceneState();
      const result = JSON.parse(
        await batchDesign({ operations: "X(document)" })
      );
      expect(result.error).toMatch(/^Parse error:/);
      expect(sceneState().nodesById).toBe(before.nodesById);
      expect(sceneState().rootIds).toBe(before.rootIds);
    });

    it("rolls back the whole batch when a later operation fails", async () => {
      const before = sceneState();
      const result = JSON.parse(
        await batchDesign({
          operations: [
            'I(document, {type: "frame", name: "WillNotPersist", width: 10, height: 10})',
            'U(nonexistent_node, {fill: "#000000"})',
          ].join("\n"),
        })
      );
      expect(result.error).toMatch(/^Execution error:/);
      expect(result.completedOperations).toHaveLength(1);
      expect(result.totalOperations).toBe(2);

      // Store identical: the partially-executed insert did not leak
      expect(sceneState().nodesById).toBe(before.nodesById);
      expect(sceneState().rootIds).toBe(before.rootIds);
      expect(Object.keys(sceneState().nodesById)).toHaveLength(4);
    });

    it("rejects deleting a nonexistent node", async () => {
      const result = JSON.parse(await batchDesign({ operations: "D(nope)" }));
      expect(result.error).toMatch(/Unresolved binding|Node not found/);
    });

    it("rejects more than 25 operations", async () => {
      const ops = Array.from({ length: 26 }, (_, i) =>
        `I(document, {type: "rectangle", name: "N${i}", width: 1, height: 1})`
      ).join("\n");
      const result = JSON.parse(await batchDesign({ operations: ops }));
      expect(result.error).toMatch(/Too many operations/);
      expect(Object.keys(sceneState().nodesById)).toHaveLength(4);
    });
  });

  describe("history", () => {
    it("records a single undo entry for a successful batch", async () => {
      expect(useHistoryStore.getState().past).toHaveLength(0);
      await batchDesign({
        operations: [
          'I(document, {type: "rectangle", name: "A", width: 1, height: 1})',
          'I(document, {type: "rectangle", name: "B", width: 1, height: 1})',
        ].join("\n"),
      });
      const { past } = useHistoryStore.getState();
      expect(past).toHaveLength(1);
      // The snapshot captures the pre-batch scene
      expect(past[0].rootIds).toEqual(["frame1", "rect2"]);
    });

    it("does not record history for a failed batch", async () => {
      await batchDesign({ operations: "D(nonexistent)" });
      expect(useHistoryStore.getState().past).toHaveLength(0);
    });
  });
});
