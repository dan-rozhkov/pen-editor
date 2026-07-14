import { describe, it, expect } from "vitest";
import { buildInspectData } from "../buildInspectData";
import type { FlatSceneNode } from "@/types/scene";
import type { Variable } from "@/types/variable";
import type { FillStyle, EffectStyle } from "@/types/style";
import type { TextStyle } from "@/types/textStyle";
import type { InspectUnits } from "@/store/devModeStore";

function baseArgs(nodesById: Record<string, FlatSceneNode>, nodeId: string) {
  const node = nodesById[nodeId];
  return {
    nodeId,
    nodesById,
    rect: { x: 0, y: 0, width: node.width, height: node.height },
    variables: [] as Variable[],
    fillStyles: [] as FillStyle[],
    effectStyles: [] as EffectStyle[],
    textStyles: [] as TextStyle[],
    units: "px" as InspectUnits,
    remBase: 16,
  };
}

describe("buildInspectData", () => {
  it("builds Layout section + box paddings for an auto-layout frame", () => {
    const frame: FlatSceneNode = {
      id: "f1",
      type: "frame",
      name: "Card",
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      layout: {
        autoLayout: true,
        flexDirection: "row",
        gap: 8,
        paddingTop: 12,
        paddingRight: 12,
        paddingBottom: 12,
        paddingLeft: 12,
      },
    };
    const nodesById = { f1: frame };
    const data = buildInspectData(baseArgs(nodesById, "f1"));

    expect(data.header.name).toBe("Card");
    expect(data.header.type).toBe("frame");
    expect(data.box.width).toBe(200);
    expect(data.box.height).toBe(100);
    expect(data.box.paddingTop).toBe(12);
    expect(data.box.paddingRight).toBe(12);
    expect(data.box.paddingBottom).toBe(12);
    expect(data.box.paddingLeft).toBe(12);
    expect(data.box.gap).toBe(8);

    const layoutSection = data.sections.find((s) => s.title === "Layout");
    expect(layoutSection).toBeDefined();
    const direction = layoutSection!.rows.find((r) => r.label === "Direction");
    expect(direction?.value).toBe("row");
    const gap = layoutSection!.rows.find((r) => r.label === "Gap");
    expect(gap?.value).toBe("8px");
    const padding = layoutSection!.rows.find((r) => r.label === "Padding");
    expect(padding?.value).toBe("12px");
  });

  it("omits Layout section rows when frame has no auto-layout, but box still has W/H/padding", () => {
    const rect: FlatSceneNode = {
      id: "r1",
      type: "rect",
      name: "Rect",
      x: 0,
      y: 0,
      width: 50,
      height: 40,
    };
    const nodesById = { r1: rect };
    const data = buildInspectData(baseArgs(nodesById, "r1"));

    expect(data.box.width).toBe(50);
    expect(data.box.height).toBe(40);
    expect(data.box.paddingTop).toBe(0);
    expect(data.box.paddingRight).toBe(0);
    expect(data.box.paddingBottom).toBe(0);
    expect(data.box.paddingLeft).toBe(0);
    expect(data.box.gap).toBeUndefined();

    const layoutSection = data.sections.find((s) => s.title === "Layout");
    expect(layoutSection).toBeUndefined();
  });

  it("builds Typography section for a text node, incl. raw text row and style token row", () => {
    const text: FlatSceneNode = {
      id: "t1",
      type: "text",
      name: "Label",
      x: 0,
      y: 0,
      width: 100,
      height: 20,
      text: "Hello world",
      fontFamily: "Inter",
      fontWeight: "600",
      fontSize: 14,
      lineHeight: 1.4,
      letterSpacing: 0.2,
      textStyleId: "ts1",
    };
    const nodesById = { t1: text };
    const args = baseArgs(nodesById, "t1");
    args.textStyles = [{ id: "ts1", name: "Body/Medium", fontFamily: "Inter", fontSize: 14 }];
    const data = buildInspectData(args);

    const typography = data.sections.find((s) => s.title === "Typography");
    expect(typography).toBeDefined();
    const rows = typography!.rows;
    expect(rows.find((r) => r.label === "Family")?.value).toBe("Inter");
    expect(rows.find((r) => r.label === "Weight")?.value).toBe("600");
    expect(rows.find((r) => r.label === "Size")?.value).toBe("14px");
    expect(rows.find((r) => r.label === "Line height")?.value).toBe("1.4");
    expect(rows.find((r) => r.label === "Letter spacing")?.value).toBe("0.2px");
    expect(rows.find((r) => r.label === "Text")?.value).toBe("Hello world");
    expect(rows.find((r) => r.label === "Style")?.value).toBe("Body/Medium");
  });

  it("shows a Fills row with resolved hex + variable token for a colorBinding solid fill", () => {
    const rect: FlatSceneNode = {
      id: "r2",
      type: "rect",
      name: "Swatch",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      fills: [
        {
          id: "p1",
          type: "solid",
          color: "#ff0000",
          colorBinding: { variableId: "v1" },
        },
      ],
    };
    const nodesById = { r2: rect };
    const args = baseArgs(nodesById, "r2");
    args.variables = [
      {
        id: "v1",
        name: "Brand/Red",
        type: "color",
        value: "#ff0000",
        themeValues: { light: "#ff0000", dark: "#cc0000" },
      },
    ];
    const data = buildInspectData(args);

    const fills = data.sections.find((s) => s.title === "Fills");
    expect(fills).toBeDefined();
    const row = fills!.rows[0];
    expect(row.value).toBe("#ff0000");
    expect(row.token).toEqual({ name: "Brand/Red", light: "#ff0000", dark: "#cc0000" });
  });

  it("shows a FillStyle name for a solid paint with styleId", () => {
    const rect: FlatSceneNode = {
      id: "r3",
      type: "rect",
      name: "Swatch2",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      fills: [{ id: "p1", type: "solid", color: "#000000", styleId: "fs1" }],
    };
    const nodesById = { r3: rect };
    const args = baseArgs(nodesById, "r3");
    args.fillStyles = [
      { id: "fs1", name: "Surface/Primary", paint: { id: "p1", type: "solid", color: "#123456" } },
    ];
    const data = buildInspectData(args);

    const fills = data.sections.find((s) => s.title === "Fills");
    const row = fills!.rows[0];
    expect(row.value).toBe("Surface/Primary");
    expect(row.copyValue).toBe("#123456");
  });

  it("builds an Effects row for a drop shadow", () => {
    const rect: FlatSceneNode = {
      id: "r4",
      type: "rect",
      name: "Card2",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      effects: [
        {
          type: "shadow",
          shadowType: "outer",
          color: "#00000040",
          offset: { x: 0, y: 4 },
          blur: 8,
          spread: 0,
        },
      ],
    };
    const nodesById = { r4: rect };
    const data = buildInspectData(baseArgs(nodesById, "r4"));

    const effects = data.sections.find((s) => s.title === "Effects");
    expect(effects).toBeDefined();
    expect(effects!.rows[0].value).toBe("0px 4px 8px 0px #00000040");
  });

  it("builds a 4-value Radius row for per-corner radius", () => {
    const rect: FlatSceneNode = {
      id: "r5",
      type: "rect",
      name: "Card3",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      cornerRadiusPerCorner: { topLeft: 4, topRight: 8, bottomRight: 12, bottomLeft: 16 },
    };
    const nodesById = { r5: rect };
    const data = buildInspectData(baseArgs(nodesById, "r5"));

    const radius = data.sections.find((s) => s.title === "Radius");
    expect(radius).toBeDefined();
    expect(radius!.rows[0].value).toBe("4px 8px 12px 16px");
  });

  it("formats dimensions in rem when units is rem", () => {
    const rect: FlatSceneNode = {
      id: "r6",
      type: "rect",
      name: "RemBox",
      x: 0,
      y: 0,
      width: 32,
      height: 16,
      cornerRadius: 16,
    };
    const nodesById = { r6: rect };
    const args = baseArgs(nodesById, "r6");
    args.units = "rem";
    const data = buildInspectData(args);

    expect(data.box.width).toBe(32); // raw numbers stay numeric
    const radius = data.sections.find((s) => s.title === "Radius");
    expect(radius!.rows[0].value).toBe("1rem");
  });
});
