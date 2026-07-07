import { describe, it, expect, beforeEach } from "vitest";
import { batchDesign } from "@/lib/tools/batchDesign";
import { useSceneStore } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";
import { resetStores, seedScene, seedVariables } from "@/test/fixtures";
import type { Effect, FlatFrameNode, FlatSceneNode, Paint, ShadowEffect, TextNode, ConnectorNode } from "@/types/scene";

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

    it("creates a masked group (masker shape + masked sibling)", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations:
            'g=I(document, {type: "frame", name: "Masked", width: 100, height: 100, children: [{type: "ellipse", name: "MaskShape", width: 100, height: 100, isMask: true}, {type: "rectangle", name: "Content", width: 100, height: 100, fill: "#ff00ff"}]})',
        })
      );
      expect(result.success).toBe(true);

      const groupId = result.createdNodes[0].id;
      const { nodesById, childrenById } = sceneState();
      const childIds = childrenById[groupId];
      expect(childIds).toHaveLength(2);
      expect(nodesById[childIds[0]].isMask).toBe(true);
      expect(nodesById[childIds[1]].isMask).toBeFalsy();
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

  describe("shape params: star/arc/arrowheads", () => {
    it("creates a regular polygon and auto-generates points from sides alone", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations:
            'p=I(document, {type: "polygon", name: "Hex", width: 100, height: 100, sides: 6})',
        })
      );
      expect(result.success).toBe(true);
      const node = sceneState().nodesById[result.createdNodes[0].id] as Record<string, unknown>;
      expect(node.sides).toBe(6);
      expect(Array.isArray(node.points)).toBe(true);
      expect((node.points as number[]).length).toBe(12);
    });

    it("creates a star and auto-generates 2x vertices from sides + innerRadiusRatio", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations:
            'p=I(document, {type: "polygon", name: "Star", width: 100, height: 100, sides: 5, innerRadiusRatio: 0.5})',
        })
      );
      expect(result.success).toBe(true);
      const node = sceneState().nodesById[result.createdNodes[0].id] as Record<string, unknown>;
      expect(node.innerRadiusRatio).toBe(0.5);
      expect((node.points as number[]).length).toBe(20);
    });

    it("regenerates star points on update when innerRadiusRatio changes but points isn't passed", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations: [
            'p=I(document, {type: "polygon", name: "Star", width: 100, height: 100, sides: 5})',
            'U(p, {innerRadiusRatio: 0.4})',
          ].join("\n"),
        })
      );
      expect(result.success).toBe(true);
      const node = sceneState().nodesById[result.createdNodes[0].id] as Record<string, unknown>;
      expect(node.innerRadiusRatio).toBe(0.4);
      expect((node.points as number[]).length).toBe(20);
    });

    it("respects an explicit points array over auto-generation", async () => {
      const explicitPoints = [1, 2, 3, 4, 5, 6];
      const result = JSON.parse(
        await batchDesign({
          operations:
            'p=I(document, {type: "polygon", name: "Custom", width: 100, height: 100, sides: 5, innerRadiusRatio: 0.5, points: [1,2,3,4,5,6]})',
        })
      );
      expect(result.success).toBe(true);
      const node = sceneState().nodesById[result.createdNodes[0].id] as Record<string, unknown>;
      expect(node.points).toEqual(explicitPoints);
    });

    it("creates an ellipse with arc/donut params", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations:
            'e=I(document, {type: "ellipse", name: "Donut", width: 80, height: 80, startAngle: 10, sweepAngle: 270, innerRadiusRatio: 0.4})',
        })
      );
      expect(result.success).toBe(true);
      const node = sceneState().nodesById[result.createdNodes[0].id] as Record<string, unknown>;
      expect(node.startAngle).toBe(10);
      expect(node.sweepAngle).toBe(270);
      expect(node.innerRadiusRatio).toBe(0.4);
    });

    it("creates a line with start/end arrowhead caps", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations:
            'l=I(document, {type: "line", name: "Arrow", width: 100, height: 0, points: [0,0,100,0], startCap: "circle", endCap: "triangle"})',
        })
      );
      expect(result.success).toBe(true);
      const node = sceneState().nodesById[result.createdNodes[0].id] as Record<string, unknown>;
      expect(node.startCap).toBe("circle");
      expect(node.endCap).toBe("triangle");
    });

    it("updates a line's caps in place", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations: [
            'l=I(document, {type: "line", name: "Arrow", width: 100, height: 0, points: [0,0,100,0]})',
            'U(l, {startCap: "bar", endCap: "arrow"})',
          ].join("\n"),
        })
      );
      expect(result.success).toBe(true);
      const node = sceneState().nodesById[result.createdNodes[0].id] as Record<string, unknown>;
      expect(node.startCap).toBe("bar");
      expect(node.endCap).toBe("arrow");
    });
  });

  describe("effects (shadow/blur stack)", () => {
    it("creates a node with an inner shadow effect", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations:
            'r=I(document, {type: "rectangle", name: "Inset", width: 10, height: 10, effects: [{type: "shadow", shadowType: "inner", color: "#00000080", offset: {x: 2, y: 2}, blur: 4, spread: 0}]})',
        })
      );
      expect(result.success).toBe(true);
      const node = sceneState().nodesById[result.createdNodes[0].id];
      const effects = node.effects as Effect[];
      expect(effects).toHaveLength(1);
      expect(effects[0]).toMatchObject({
        type: "shadow",
        shadowType: "inner",
        color: "#00000080",
        offset: { x: 2, y: 2 },
        blur: 4,
      });
    });

    it("U() with effects replaces the stack, supporting both drop and inner shadow together", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations: [
            'r=I(document, {type: "rectangle", name: "Combo", width: 10, height: 10})',
            'U(r, {effects: [{type: "shadow", shadowType: "outer", color: "#00000040", offset: {x: 0, y: 4}, blur: 8, spread: 0}, {type: "shadow", shadowType: "inner", color: "#00000080", offset: {x: 0, y: 2}, blur: 4, spread: 0}]})',
          ].join("\n"),
        })
      );
      expect(result.success).toBe(true);
      const effects = sceneState().nodesById[result.createdNodes[0].id].effects as ShadowEffect[];
      expect(effects).toHaveLength(2);
      expect(effects[0].shadowType).toBe("outer");
      expect(effects[1].shadowType).toBe("inner");
    });
  });

  describe("fills (paint stack)", () => {
    it("creates a node with a multi-paint fills stack and generates ids", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations:
            'r=I(document, {type: "rectangle", name: "Layered", width: 10, height: 10, fills: [{type: "solid", color: "#ff0000"}, {type: "solid", color: "#00ff00", opacity: 0.5}]})',
        })
      );
      expect(result.success).toBe(true);
      const node = sceneState().nodesById[result.createdNodes[0].id];
      const fills = node.fills as Paint[];
      expect(fills).toHaveLength(2);
      expect(fills[0]).toMatchObject({ type: "solid", color: "#ff0000" });
      expect(fills[1]).toMatchObject({ type: "solid", color: "#00ff00", opacity: 0.5 });
      // ids are generated, present and unique
      expect(typeof fills[0].id).toBe("string");
      expect(fills[0].id).not.toBe(fills[1].id);
      // legacy single-fill field is not set when fills is the source of truth
      expect(node.fill).toBeUndefined();
    });

    it("normalizes a flat image paint and a nested image paint", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations:
            'r=I(document, {type: "rectangle", name: "Img", width: 10, height: 10, fills: [{type: "image", url: "https://x/a.png", mode: "fit"}, {type: "image", image: {url: "https://x/b.png", mode: "stretch"}}]})',
        })
      );
      expect(result.success).toBe(true);
      const fills = sceneState().nodesById[result.createdNodes[0].id].fills as Paint[];
      expect(fills[0]).toMatchObject({
        type: "image",
        image: { url: "https://x/a.png", mode: "fit" },
      });
      expect(fills[1]).toMatchObject({
        type: "image",
        image: { url: "https://x/b.png", mode: "stretch" },
      });
    });

    it("normalizes a flat pattern paint and a nested pattern paint", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations:
            'r=I(document, {type: "rectangle", name: "Pat", width: 10, height: 10, fills: [{type: "pattern", url: "https://x/tile.png", scale: 0.5, spacingX: 4, rowOffset: 0.5}, {type: "pattern", pattern: {url: "https://x/tile2.png", offsetX: 2, offsetY: 3}, opacity: 0.5, blendMode: "multiply"}]})',
        })
      );
      expect(result.success).toBe(true);
      const fills = sceneState().nodesById[result.createdNodes[0].id].fills as Paint[];
      expect(fills[0]).toMatchObject({
        type: "pattern",
        pattern: { url: "https://x/tile.png", scale: 0.5, spacingX: 4, rowOffset: 0.5 },
      });
      expect(fills[1]).toMatchObject({
        type: "pattern",
        pattern: { url: "https://x/tile2.png", offsetX: 2, offsetY: 3 },
        opacity: 0.5,
        blendMode: "multiply",
      });
    });

    it("drops a pattern paint without a tile url, keeping the rest of the stack", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations:
            'r=I(document, {type: "rectangle", name: "BadPat", width: 10, height: 10, fills: [{type: "solid", color: "#112233"}, {type: "pattern", scale: 2}]})',
        })
      );
      expect(result.success).toBe(true);
      const fills = sceneState().nodesById[result.createdNodes[0].id].fills as Paint[];
      expect(fills).toHaveLength(1);
      expect(fills[0]).toMatchObject({ type: "solid", color: "#112233" });
    });

    it("drops a pattern paint on a node type that can't render sprite fills, with an issue message", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations:
            'p=I(document, {type: "path", name: "PatPath", geometry: "M0,0 L10,0 L10,10 Z", width: 10, height: 10, fills: [{type: "solid", color: "#112233"}, {type: "pattern", url: "https://x/tile.png"}]})',
        })
      );
      expect(result.success).toBe(true);
      const fills = sceneState().nodesById[result.createdNodes[0].id].fills as Paint[];
      expect(fills).toHaveLength(1);
      expect(fills[0]).toMatchObject({ type: "solid", color: "#112233" });
      expect(result.issues).toBeDefined();
      expect(result.issues.some((i: string) => i.includes("Pattern fill") && i.includes("path"))).toBe(
        true,
      );
    });

    it("honors the type discriminator: an image-typed paint with a `pattern` object stays an image paint", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations:
            'r=I(document, {type: "rectangle", name: "Mixed", width: 10, height: 10, fills: [{type: "image", url: "https://x/a.png", mode: "fit", pattern: {url: "https://x/tile.png"}}]})',
        })
      );
      expect(result.success).toBe(true);
      const fills = sceneState().nodesById[result.createdNodes[0].id].fills as Paint[];
      expect(fills).toHaveLength(1);
      expect(fills[0]).toMatchObject({
        type: "image",
        image: { url: "https://x/a.png", mode: "fit" },
      });
    });

    it("normalizes a flat gradient paint into the nested form", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations:
            'r=I(document, {type: "rectangle", name: "Grad", width: 10, height: 10, fills: [{type: "gradient", gradient: {type: "linear", stops: [{color: "#000000", position: 0}, {color: "#ffffff", position: 1}], startX: 0, startY: 0, endX: 1, endY: 1}}]})',
        })
      );
      expect(result.success).toBe(true);
      const fills = sceneState().nodesById[result.createdNodes[0].id].fills as Paint[];
      expect(fills[0].type).toBe("gradient");
      expect(fills[0]).toMatchObject({
        gradient: { type: "linear", startX: 0, endX: 1 },
      });
    });

    it("resolves $variable references inside solid fills to value + binding", async () => {
      seedVariables();
      const result = JSON.parse(
        await batchDesign({
          operations:
            'r=I(document, {type: "rectangle", name: "Var", width: 10, height: 10, fills: [{type: "solid", color: "$--primary"}]})',
        })
      );
      expect(result.success).toBe(true);
      const fills = sceneState().nodesById[result.createdNodes[0].id].fills as Paint[];
      expect(fills[0]).toMatchObject({
        type: "solid",
        color: "#3366ff",
        colorBinding: { variableId: "var-primary" },
      });
    });

    it("U() with fills replaces the stack and clears legacy fill props", async () => {
      // rect1 starts with legacy fill #ff0000
      const result = JSON.parse(
        await batchDesign({
          operations:
            'U(rect1, {fills: [{type: "solid", color: "#0000ff"}]})',
        })
      );
      expect(result.success).toBe(true);
      const node = sceneState().nodesById["rect1"] as Record<string, unknown>;
      const fills = node.fills as Paint[];
      expect(fills).toHaveLength(1);
      expect(fills[0]).toMatchObject({ type: "solid", color: "#0000ff" });
      // legacy fields cleared
      expect(node.fill).toBeUndefined();
      expect(node.fillBinding).toBeUndefined();
      expect(node.gradientFill).toBeUndefined();
      expect(node.imageFill).toBeUndefined();
    });

    it("G() pushes an image paint on top of an existing fills stack", async () => {
      await batchDesign({
        operations:
          'U(rect1, {fills: [{type: "solid", color: "#0000ff"}]})',
      });
      const result = JSON.parse(
        await batchDesign({ operations: 'G(rect1, "ai", "a cat")' })
      );
      expect(result.success).toBe(true);
      const fills = sceneState().nodesById["rect1"].fills as Paint[];
      expect(fills).toHaveLength(2);
      expect(fills[0]).toMatchObject({ type: "solid", color: "#0000ff" });
      expect(fills[1].type).toBe("image");
    });

    it("G() replaces the topmost image paint instead of stacking duplicates", async () => {
      await batchDesign({
        operations:
          'U(rect1, {fills: [{type: "solid", color: "#0000ff"}, {type: "image", url: "https://x/old.png", mode: "fill"}]})',
      });
      const result = JSON.parse(
        await batchDesign({ operations: 'G(rect1, "ai", "a dog")' })
      );
      expect(result.success).toBe(true);
      const fills = sceneState().nodesById["rect1"].fills as Paint[];
      expect(fills).toHaveLength(2);
      expect(fills[1].type).toBe("image");
      expect((fills[1] as { image: { url: string } }).image.url).not.toBe(
        "https://x/old.png"
      );
    });

    it("G() migrates a legacy node to a fills stack, keeping its fill as the bottom layer", async () => {
      // rect1 starts with legacy fill #ff0000 and no fills stack
      const result = JSON.parse(
        await batchDesign({ operations: 'G(rect1, "ai", "a bird")' })
      );
      expect(result.success).toBe(true);
      const node = sceneState().nodesById["rect1"] as Record<string, unknown>;
      const fills = node.fills as Paint[];
      expect(fills).toHaveLength(2);
      expect(fills[0]).toMatchObject({ type: "solid", color: "#ff0000" });
      expect(fills[1].type).toBe("image");
      // legacy single-fill fields are cleared once fills is the source of truth
      expect(node.fill).toBeUndefined();
      expect(node.imageFill).toBeUndefined();
    });

    it("U() with legacy fill on a fills node updates the topmost solid paint", async () => {
      await batchDesign({
        operations:
          'U(rect1, {fills: [{type: "solid", color: "#0000ff"}, {type: "image", url: "https://x/a.png", mode: "fill"}]})',
      });
      const result = JSON.parse(
        await batchDesign({ operations: 'U(rect1, {fill: "#00ff00"})' })
      );
      expect(result.success).toBe(true);
      const node = sceneState().nodesById["rect1"] as Record<string, unknown>;
      const fills = node.fills as Paint[];
      expect(fills).toHaveLength(2);
      expect(fills[0]).toMatchObject({ type: "solid", color: "#00ff00" });
      expect(fills[1].type).toBe("image");
      // legacy field is not written — the stack stays the source of truth
      expect(node.fill).toBeUndefined();
    });

    it("U() with legacy fill adds a solid paint on top when the stack has none", async () => {
      await batchDesign({
        operations:
          'U(rect1, {fills: [{type: "image", url: "https://x/a.png", mode: "fill"}]})',
      });
      const result = JSON.parse(
        await batchDesign({ operations: 'U(rect1, {fill: "#00ff00"})' })
      );
      expect(result.success).toBe(true);
      const node = sceneState().nodesById["rect1"] as Record<string, unknown>;
      const fills = node.fills as Paint[];
      expect(fills).toHaveLength(2);
      expect(fills[0].type).toBe("image");
      expect(fills[1]).toMatchObject({ type: "solid", color: "#00ff00" });
      expect(node.fill).toBeUndefined();
    });

    it("U() with legacy imageFill on a fills node updates the topmost image paint", async () => {
      await batchDesign({
        operations:
          'U(rect1, {fills: [{type: "solid", color: "#0000ff"}, {type: "image", url: "https://x/old.png", mode: "fill"}]})',
      });
      const result = JSON.parse(
        await batchDesign({
          operations:
            'U(rect1, {imageFill: {url: "https://x/new.png", mode: "fit"}})',
        })
      );
      expect(result.success).toBe(true);
      const node = sceneState().nodesById["rect1"] as Record<string, unknown>;
      const fills = node.fills as Paint[];
      expect(fills).toHaveLength(2);
      expect(fills[1]).toMatchObject({
        type: "image",
        image: { url: "https://x/new.png", mode: "fit" },
      });
      expect(node.imageFill).toBeUndefined();
    });

    it("U() with a $variable fill on a fills node binds the topmost solid paint", async () => {
      seedVariables();
      await batchDesign({
        operations: 'U(rect1, {fills: [{type: "solid", color: "#0000ff"}]})',
      });
      const result = JSON.parse(
        await batchDesign({ operations: 'U(rect1, {fill: "$--primary"})' })
      );
      expect(result.success).toBe(true);
      const node = sceneState().nodesById["rect1"] as Record<string, unknown>;
      const fills = node.fills as Paint[];
      expect(fills[0]).toMatchObject({
        type: "solid",
        color: "#3366ff",
        colorBinding: { variableId: "var-primary" },
      });
      expect(node.fillBinding).toBeUndefined();
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

    it("sets isMask on an existing node (layer mask flag)", async () => {
      const result = JSON.parse(
        await batchDesign({ operations: "U(rect2, {isMask: true})" })
      );
      expect(result.success).toBe(true);
      expect(sceneState().nodesById["rect2"].isMask).toBe(true);
    });

    it("unsets isMask on an existing node", async () => {
      await batchDesign({ operations: "U(rect2, {isMask: true})" });
      const result = JSON.parse(
        await batchDesign({ operations: "U(rect2, {isMask: false})" })
      );
      expect(result.success).toBe(true);
      expect(sceneState().nodesById["rect2"].isMask).toBe(false);
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

    it("sets wrap and per-axis gaps on an existing frame", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations: "U(frame1, {wrap: true, rowGap: 12, columnGap: 4})",
        })
      );
      expect(result.success).toBe(true);
      const frame = sceneState().nodesById["frame1"] as FlatFrameNode;
      expect(frame.layout?.flexWrap).toBe(true);
      expect(frame.layout?.rowGap).toBe(12);
      expect(frame.layout?.columnGap).toBe(4);
      // Pre-existing padding from the fixture is preserved
      expect(frame.layout?.paddingTop).toBe(16);
    });

    it("sets min/max width/height sizing constraints on an existing node", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations:
            "U(rect2, {minWidth: 50, maxWidth: 400, minHeight: 20, maxHeight: 300})",
        })
      );
      expect(result.success).toBe(true);
      const node = sceneState().nodesById["rect2"] as FlatSceneNode;
      expect(node.sizing).toMatchObject({
        minWidth: 50,
        maxWidth: 400,
        minHeight: 20,
        maxHeight: 300,
      });
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

    it("maps a cornerRadius array to per-corner radii and clears the unified value", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations: "U(rect1, {cornerRadius: [12, 8, 4, 0]})",
        })
      );
      expect(result.success).toBe(true);
      const rect = sceneState().nodesById["rect1"] as FlatSceneNode & {
        cornerRadius?: number;
        cornerRadiusPerCorner?: {
          topLeft?: number;
          topRight?: number;
          bottomRight?: number;
          bottomLeft?: number;
        };
      };
      expect(rect.cornerRadiusPerCorner).toEqual({
        topLeft: 12,
        topRight: 8,
        bottomRight: 4,
        bottomLeft: 0,
      });
      // The fixture's unified cornerRadius (4) is cleared.
      expect(rect.cornerRadius).toBeUndefined();
    });

    it("expands CSS-shorthand cornerRadius arrays (2 values)", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations: "U(rect1, {cornerRadius: [10, 20]})",
        })
      );
      expect(result.success).toBe(true);
      const rect = sceneState().nodesById["rect1"] as FlatSceneNode & {
        cornerRadiusPerCorner?: Record<string, number>;
      };
      expect(rect.cornerRadiusPerCorner).toEqual({
        topLeft: 10,
        topRight: 20,
        bottomRight: 10,
        bottomLeft: 20,
      });
    });

    it("accepts a cornerRadiusPerCorner object and clears the unified radius", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations:
            "U(rect1, {cornerRadiusPerCorner: {topLeft: 6, bottomRight: 6}})",
        })
      );
      expect(result.success).toBe(true);
      const rect = sceneState().nodesById["rect1"] as FlatSceneNode & {
        cornerRadius?: number;
        cornerRadiusPerCorner?: Record<string, number | undefined>;
      };
      expect(rect.cornerRadiusPerCorner).toEqual({
        topLeft: 6,
        topRight: undefined,
        bottomRight: 6,
        bottomLeft: undefined,
      });
      expect(rect.cornerRadius).toBeUndefined();
    });

    it("keeps a numeric cornerRadius unified and clears any per-corner radii", async () => {
      // First set per-corner, then overwrite with a unified number.
      await batchDesign({
        operations: "U(rect1, {cornerRadius: [1, 2, 3, 4]})",
      });
      const result = JSON.parse(
        await batchDesign({ operations: "U(rect1, {cornerRadius: 9})" })
      );
      expect(result.success).toBe(true);
      const rect = sceneState().nodesById["rect1"] as FlatSceneNode & {
        cornerRadius?: number;
        cornerRadiusPerCorner?: unknown;
      };
      expect(rect.cornerRadius).toBe(9);
      expect(rect.cornerRadiusPerCorner).toBeUndefined();
    });

    it("maps cornerSmoothing as a 0-1 fraction, clamped to range", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations: "U(rect1, {cornerSmoothing: 0.6})",
        })
      );
      expect(result.success).toBe(true);
      const rect = sceneState().nodesById["rect1"] as FlatSceneNode & {
        cornerSmoothing?: number;
      };
      expect(rect.cornerSmoothing).toBe(0.6);

      const overRange = JSON.parse(
        await batchDesign({
          operations: "U(rect1, {cornerSmoothing: 5})",
        })
      );
      expect(overRange.success).toBe(true);
      expect((sceneState().nodesById["rect1"] as FlatSceneNode & { cornerSmoothing?: number }).cornerSmoothing).toBe(1);
    });

    it("sets constraints on a node", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations:
            'U(rect1, {constraints: {horizontal: "stretch", vertical: "center"}})',
        })
      );
      expect(result.success).toBe(true);
      const rect = sceneState().nodesById["rect1"] as FlatSceneNode & {
        constraints?: { horizontal: string; vertical: string };
      };
      expect(rect.constraints).toEqual({ horizontal: "stretch", vertical: "center" });
    });

    it("normalizes Figma-ish constraint aliases and falls back to 'min' for unknown modes", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations:
            'U(rect1, {constraints: {horizontal: "left-right", vertical: "bogus"}})',
        })
      );
      expect(result.success).toBe(true);
      const rect = sceneState().nodesById["rect1"] as FlatSceneNode & {
        constraints?: { horizontal: string; vertical: string };
      };
      expect(rect.constraints).toEqual({ horizontal: "stretch", vertical: "min" });
    });

    it("accepts constraints on insert", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations:
            'child=I(frame1, {type: "rect", width: 40, height: 40, constraints: {horizontal: "scale", vertical: "max"}})',
        })
      );
      expect(result.success).toBe(true);
      const id = result.createdNodes[0].id;
      const inserted = sceneState().nodesById[id] as FlatSceneNode & {
        constraints?: unknown;
      };
      expect(inserted.constraints).toEqual({ horizontal: "scale", vertical: "max" });
    });
  });

  describe("component properties (variants)", () => {
    // Bindings created within one batch_design call only resolve as top-level
    // I()/C()/U() arguments (parent/sourceId/path) — not inside nested JSON
    // object literals (see parser.ts classifyToken). So declaring properties
    // whose bindingPath points at a just-created descendant, or creating a ref
    // whose componentId points at a just-created component, needs the real ids
    // back from a first call before referencing them (quoted) in a follow-up
    // call — exactly the flow the tool description tells the AI to use for
    // "existing node IDs from previous tool results".

    it("creates a reusable component with a descendant, then declares a variant property targeting it by its real id", async () => {
      const setup = JSON.parse(
        await batchDesign({
          operations: [
            'comp=I(document, {type: "frame", name: "Button", reusable: true, width: 120, height: 40})',
            'label=I(comp, {type: "text", name: "Label", content: "Click me", width: 80, height: 20})',
          ].join("\n"),
        })
      );
      expect(setup.success).toBe(true);
      const [compId, labelId] = setup.createdNodes.map((n: { id: string }) => n.id);

      const result = JSON.parse(
        await batchDesign({
          operations: `U("${compId}", {properties: [{id: "state", name: "State", type: "variant", variantOptions: ["default", "hover"], defaultValue: "default", bindingPath: "${labelId}", bindingProp: "fill"}]})`,
        })
      );
      expect(result.success).toBe(true);

      const comp = sceneState().nodesById[compId] as FlatFrameNode & { properties?: unknown };
      expect(comp.reusable).toBe(true);
      expect(comp.properties).toEqual([
        {
          id: "state",
          name: "State",
          type: "variant",
          variantOptions: ["default", "hover"],
          defaultValue: "default",
          bindingPath: labelId,
          bindingProp: "fill",
        },
      ]);
    });

    it("creates an instance of an existing component by its (quoted) id", async () => {
      const setup = JSON.parse(
        await batchDesign({
          operations: 'comp=I(document, {type: "frame", name: "Button", reusable: true, width: 120, height: 40})',
        })
      );
      const [compId] = setup.createdNodes.map((n: { id: string }) => n.id);

      const result = JSON.parse(
        await batchDesign({
          operations: `inst=I(document, {type: "ref", componentId: "${compId}", width: 120, height: 40})`,
        })
      );
      expect(result.success).toBe(true);
      const [instId] = result.createdNodes.map((n: { id: string }) => n.id);

      const inst = sceneState().nodesById[instId] as FlatSceneNode & { componentId?: string };
      expect(inst.type).toBe("ref");
      expect(inst.componentId).toBe(compId);
    });

    /**
     * Create a component (with a "label" text child), declare `state` (variant)
     * and `showIcon` (boolean) properties on it, and instantiate it. Returns
     * the real ids: { compId, labelId, instId }.
     */
    async function seedComponentWithPropertiesAndInstance(): Promise<{
      compId: string;
      labelId: string;
      instId: string;
    }> {
      const setup = JSON.parse(
        await batchDesign({
          operations: [
            'comp=I(document, {type: "frame", name: "Button", reusable: true, width: 120, height: 40})',
            'label=I(comp, {type: "text", name: "Label", content: "Click me", width: 80, height: 20})',
          ].join("\n"),
        })
      );
      const [compId, labelId] = setup.createdNodes.map((n: { id: string }) => n.id);

      const declared = JSON.parse(
        await batchDesign({
          operations: [
            `U("${compId}", {properties: [` +
              `{id: "state", name: "State", type: "variant", variantOptions: ["default", "hover"], defaultValue: "default", bindingPath: "${labelId}", bindingProp: "fill"}, ` +
              `{id: "showIcon", name: "Show icon", type: "boolean", defaultValue: true, bindingPath: "${labelId}", bindingProp: "visible"}` +
              `]})`,
            `inst=I(document, {type: "ref", componentId: "${compId}", width: 120, height: 40})`,
          ].join("\n"),
        })
      );
      expect(declared.success).toBe(true);
      const [instId] = declared.createdNodes.map((n: { id: string }) => n.id);
      return { compId, labelId, instId };
    }

    it("switches an instance's property value via propertyValues without touching its overrides", async () => {
      const { labelId, instId } = await seedComponentWithPropertiesAndInstance();

      // An explicit override, set independently of any property.
      sceneState().updateInstanceOverride(instId, labelId, { x: 5 });

      const result = JSON.parse(
        await batchDesign({
          operations: `U("${instId}", {propertyValues: {state: "hover"}})`,
        })
      );
      expect(result.success).toBe(true);

      const inst = sceneState().nodesById[instId] as FlatSceneNode & {
        propertyValues?: Record<string, unknown>;
        overrides?: Record<string, unknown>;
      };
      expect(inst.propertyValues).toEqual({ state: "hover" });
      expect(inst.overrides?.[labelId]).toEqual({ kind: "update", props: { x: 5 } });
    });

    it("merges propertyValues by key on repeated U() calls instead of replacing the whole object", async () => {
      const { instId } = await seedComponentWithPropertiesAndInstance();

      await batchDesign({ operations: `U("${instId}", {propertyValues: {state: "hover"}})` });
      await batchDesign({ operations: `U("${instId}", {propertyValues: {showIcon: false}})` });

      const inst = sceneState().nodesById[instId] as FlatSceneNode & {
        propertyValues?: Record<string, unknown>;
      };
      expect(inst.propertyValues).toEqual({ state: "hover", showIcon: false });
    });

    it("rejects a variant value outside the declared options and leaves the instance unchanged", async () => {
      const { instId } = await seedComponentWithPropertiesAndInstance();

      const result = JSON.parse(
        await batchDesign({
          operations: `U("${instId}", {propertyValues: {state: "disabled"}})`,
        })
      );
      expect(result.success).toBeUndefined();
      expect(result.error).toMatch(/state.*disabled|disabled.*state/i);

      const inst = sceneState().nodesById[instId] as FlatSceneNode & {
        propertyValues?: Record<string, unknown>;
      };
      expect(inst.propertyValues).toBeUndefined();
    });

    it("rejects a wrong-typed value for a boolean property", async () => {
      const { instId } = await seedComponentWithPropertiesAndInstance();

      const result = JSON.parse(
        await batchDesign({
          operations: `U("${instId}", {propertyValues: {showIcon: "false"}})`,
        })
      );
      expect(result.success).toBeUndefined();
      expect(result.error).toMatch(/showIcon/);

      const inst = sceneState().nodesById[instId] as FlatSceneNode & {
        propertyValues?: Record<string, unknown>;
      };
      expect(inst.propertyValues).toBeUndefined();
    });

    it("rejects a propertyValues key the component never declared", async () => {
      const { instId } = await seedComponentWithPropertiesAndInstance();

      const result = JSON.parse(
        await batchDesign({
          operations: `U("${instId}", {propertyValues: {doesNotExist: "x"}})`,
        })
      );
      expect(result.success).toBeUndefined();
      expect(result.error).toMatch(/doesNotExist/);
    });

    it("rejects propertyValues on a non-ref node", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations: 'U(rect2, {propertyValues: {state: "hover"}})',
        })
      );
      expect(result.success).toBeUndefined();
      expect(result.error).toMatch(/propertyValues/);
      expect(
        (sceneState().nodesById["rect2"] as FlatSceneNode & { propertyValues?: unknown }).propertyValues,
      ).toBeUndefined();
    });

    it("rejects a properties declaration on a non-reusable node", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations:
            'U(rect2, {properties: [{id: "state", name: "State", type: "variant", variantOptions: ["a"], defaultValue: "a", bindingPath: "x", bindingProp: "fill"}]})',
        })
      );
      expect(result.success).toBeUndefined();
      expect(result.error).toMatch(/properties/);
      expect(
        (sceneState().nodesById["rect2"] as FlatSceneNode & { properties?: unknown }).properties,
      ).toBeUndefined();
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

  // S3: AI delete/replace must not leave connectors dangling into removed nodes.
  describe("connector cleanup (S3)", () => {
    function addConnector(id: string, startNodeId: string, endNodeId: string) {
      useSceneStore.setState((s) => ({
        nodesById: {
          ...s.nodesById,
          [id]: {
            id,
            type: "connector",
            name: "Connector",
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            startConnection: { nodeId: startNodeId, anchor: "right" },
            endConnection: { nodeId: endNodeId, anchor: "left" },
            points: [0, 0, 0, 0],
          } as unknown as FlatSceneNode,
        },
        parentById: { ...s.parentById, [id]: null },
        rootIds: [...s.rootIds, id],
        _cachedTree: null,
      }));
    }

    it("D() removes connectors anchored to a deleted node", async () => {
      addConnector("conn1", "rect1", "rect2");

      const result = JSON.parse(await batchDesign({ operations: "D(rect1)" }));

      expect(result.success).toBe(true);
      expect(sceneState().nodesById["conn1"]).toBeUndefined();
      expect(sceneState().rootIds).not.toContain("conn1");
    });

    it("R() drops connectors anchored to a removed descendant of the replaced node", async () => {
      // conn1 anchors to rect1, a child of frame1; replacing frame1 removes rect1.
      addConnector("conn1", "rect1", "rect2");

      const result = JSON.parse(
        await batchDesign({
          operations: 'R(frame1, {type: "frame", name: "New", width: 100, height: 100})',
        })
      );

      expect(result.success).toBe(true);
      expect(sceneState().nodesById["conn1"]).toBeUndefined();
    });

    it("R() re-points connectors anchored to the replaced node itself", async () => {
      addConnector("conn1", "rect2", "frame1");

      const result = JSON.parse(
        await batchDesign({
          operations: 'R(frame1, {type: "frame", name: "New", width: 100, height: 100})',
        })
      );

      expect(result.success).toBe(true);
      const newId = result.createdNodes[0].id;
      const conn = sceneState().nodesById["conn1"] as ConnectorNode | undefined;
      expect(conn).toBeDefined();
      expect(conn?.endConnection.nodeId).toBe(newId);
    });
  });

  describe("text lists (paragraphs)", () => {
    it("I() creates a text node with a bulleted list via a paragraphs array", async () => {
      const result = JSON.parse(
        await batchDesign({
          operations:
            'label=I(document, {type: "text", name: "List", text: "Milk\\nEggs\\nBread", paragraphs: [{listType: "bullet"}, {listType: "bullet"}, {listType: "bullet"}]})',
        })
      );

      expect(result.success).toBe(true);
      const created = sceneState().nodesById[result.createdNodes[0].id] as TextNode;
      expect(created.paragraphs).toEqual([
        { listType: "bullet" },
        { listType: "bullet" },
        { listType: "bullet" },
      ]);
      // Auto-size (syncTextDimensions) should widen the node past the bare
      // text width to make room for the bullet markers + hanging indent.
      expect(created.width).toBeGreaterThan(0);
    });

    it("U() re-tags an existing text node's paragraphs (e.g. AI adds a numbered list)", async () => {
      const textResult = JSON.parse(
        await batchDesign({
          operations: 'label=I(document, {type: "text", name: "Steps", text: "Mix\\nBake"})',
        })
      );
      const id = textResult.createdNodes[0].id;

      const result = JSON.parse(
        await batchDesign({
          operations: `U("${id}", {paragraphs: [{listType: "number"}, {listType: "number"}]})`,
        })
      );

      expect(result.success).toBe(true);
      const updated = sceneState().nodesById[id] as TextNode;
      expect(updated.paragraphs).toEqual([{ listType: "number" }, { listType: "number" }]);
    });
  });
});
