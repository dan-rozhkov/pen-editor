import { describe, expect, it, beforeEach } from "vitest";
import type { FlatSceneNode } from "@/types/scene";
import { serializeNodeToDepth } from "../serializeUtils";
import { batchDesign } from "@/lib/tools/batchDesign";
import { batchGet } from "@/lib/tools/batchGet";
import { useSceneStore } from "@/store/sceneStore";
import { resetStores, seedScene } from "@/test/fixtures";

describe("serializeNodeToDepth — paint-level variable bindings", () => {
  const fills = [
    { id: "a", type: "solid" as const, color: "#000000", colorBinding: { variableId: "var1" } },
    { id: "b", type: "solid" as const, color: "#ffffff" },
  ];

  function makeNodesById(): Record<string, FlatSceneNode> {
    return {
      rect1: {
        id: "rect1",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        fills,
      } as unknown as FlatSceneNode,
    };
  }

  it("resolves bound paint colors when resolveVars is set", () => {
    const nodesById = makeNodesById();
    const result = serializeNodeToDepth("rect1", nodesById, {}, 1, {
      resolveVars: true,
      variableLookup: { var1: "#123456" },
    });

    expect(result).not.toBeNull();
    const resultFills = result!.fills as typeof fills;
    expect(resultFills[0].color).toBe("#123456");
    expect(resultFills[1].color).toBe("#ffffff");

    // Original store object must remain unmutated.
    expect(nodesById.rect1.fills).toEqual(fills);
    expect((nodesById.rect1.fills as typeof fills)[0].color).toBe("#000000");
  });

  it("passes fills through by reference when resolveVars is unset", () => {
    const nodesById = makeNodesById();
    const result = serializeNodeToDepth("rect1", nodesById, {}, 1);

    expect(result).not.toBeNull();
    expect(result!.fills).toBe(nodesById.rect1.fills);
  });
});

// FIR-59: fill_container/fit_content children of a fixed-size auto-layout
// frame were reported back as 0x0 by batch_get and batch_design's own
// createdNodes response, even though the auto-layout engine (yogaLayout.ts)
// resolved their real size correctly for on-screen rendering. Root cause:
// serializeNodeToDepth spread the raw flat node (width/height 0 — the
// creation-time placeholder set in batchDesign/nodeMapper.ts for non-fixed
// sizing modes) instead of the layout-resolved effective size. These tests
// exercise the actual tool read path (batch_design create + batch_get) end
// to end so they fail again if the read path regresses.
describe("serializeNodeToDepth — FIR-59 fill_container/fit_content resolution", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
  });

  it("resolves a fill_container child's width from a fixed-size vertical parent", async () => {
    const created = JSON.parse(
      await batchDesign({
        operations:
          'main=I(document, {type: "frame", name: "Main", width: 1628, height: 805, layout: "vertical"})\n' +
          'col=I(main, {type: "frame", name: "Col", width: "fill_container", height: 200})',
      })
    );
    expect(created.success).toBe(true);
    const mainId = created.createdNodes[0].id;
    const colId = created.createdNodes[1].id;

    // The raw store value is still the 0-placeholder — sizing intent lives
    // in `sizing`, not `width`.
    expect(useSceneStore.getState().nodesById[colId].width).toBe(0);

    // batch_design's own createdNodes response must report the resolved size.
    const createdCol = created.createdNodes[1];
    expect(createdCol.width).toBe(1628);
    expect(createdCol.height).toBe(200);

    // batch_get (the tool the agent actually calls to re-read state) must
    // agree.
    const got = JSON.parse(await batchGet({ nodeIds: [mainId], readDepth: 2 }));
    const colFromGet = got[0].children[0];
    expect(colFromGet.width).toBe(1628);
    expect(colFromGet.height).toBe(200);
  });

  it("resolves a nested fixed -> fill -> fill chain all the way down", async () => {
    const created = JSON.parse(
      await batchDesign({
        operations:
          'main=I(document, {type: "frame", name: "Main", width: 1000, height: 600, layout: "vertical"})\n' +
          'row=I(main, {type: "frame", name: "Row", width: "fill_container", height: "fill_container", layout: "horizontal"})\n' +
          'cell=I(row, {type: "frame", name: "Cell", width: "fill_container", height: "fill_container"})',
      })
    );
    expect(created.success).toBe(true);
    const mainId = created.createdNodes[0].id;

    const got = JSON.parse(await batchGet({ nodeIds: [mainId], readDepth: 3 }));
    const row = got[0].children[0];
    const cell = row.children[0];

    expect(row.width).toBe(1000);
    expect(row.height).toBe(600);
    expect(cell.width).toBe(1000);
    expect(cell.height).toBe(600);
  });

  it("resolves height: fill_container for a cross-axis child under alignItems: center", async () => {
    // Table-row-like case from the trace: a fixed-height row with
    // alignItems: center, and a column that should stretch to fill the row's
    // cross axis (height) despite `center` alignment — fill_container must
    // win over alignItems via alignSelf: stretch (yogaLayout.ts).
    const created = JSON.parse(
      await batchDesign({
        operations:
          'row=I(document, {type: "frame", name: "Row", width: 400, height: 56, layout: "horizontal", alignItems: "center"})\n' +
          'col=I(row, {type: "frame", name: "Column", width: 100, height: "fill_container"})',
      })
    );
    expect(created.success).toBe(true);
    const rowId = created.createdNodes[0].id;

    const got = JSON.parse(await batchGet({ nodeIds: [rowId], readDepth: 2 }));
    const col = got[0].children[0];

    expect(col.width).toBe(100);
    expect(col.height).toBe(56);
  });

  it("resolves distinct parent-relative y for each sibling in a vertical stack (not all stacked at 0,0)", async () => {
    // Matches the trace's "children at x=2764 all the same — flexbox didn't
    // propagate" symptom: every sibling after the first read back at the raw
    // stored (creation-time) x/y, which auto-layout never writes back to the
    // flat store.
    const created = JSON.parse(
      await batchDesign({
        operations:
          'main=I(document, {type: "frame", name: "Main", width: 400, height: 400, layout: "vertical", gap: 10})\n' +
          'a=I(main, {type: "frame", name: "A", width: 100, height: 50})\n' +
          'b=I(main, {type: "frame", name: "B", width: 100, height: 50})',
      })
    );
    expect(created.success).toBe(true);
    const mainId = created.createdNodes[0].id;

    const got = JSON.parse(await batchGet({ nodeIds: [mainId], readDepth: 2 }));
    const [a, b] = got[0].children;

    expect(a.y).toBe(0);
    expect(b.y).toBe(60); // 50 (A's height) + 10 (gap)
    expect(b.x).toBe(0);
  });
});
