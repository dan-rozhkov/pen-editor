import { describe, expect, it } from "vitest";
import type { FlatSceneNode, Paint, ShadowEffect } from "@/types/scene";
import type { FillStyle, EffectStyle } from "@/types/style";
import type { Variable } from "@/types/variable";
import {
  resolveFillStylePaint,
  getResolvedRenderableFills,
  resolveEffectStack,
} from "@/utils/fillUtils";
import { resolveColor } from "@/utils/colorUtils";

function makeNode(props: Partial<FlatSceneNode>): FlatSceneNode {
  return { id: "n1", type: "rect", x: 0, y: 0, width: 10, height: 10, ...props } as FlatSceneNode;
}

describe("resolveFillStylePaint", () => {
  const fillStyles: FillStyle[] = [
    { id: "fs1", name: "Brand", paint: { id: "style-paint", type: "solid", color: "#3366ff" } },
  ];

  it("returns the paint unchanged when it has no styleId", () => {
    const paint: Paint = { id: "p1", type: "solid", color: "#ff0000" };
    expect(resolveFillStylePaint(paint, fillStyles)).toBe(paint);
  });

  it("substitutes the style's paint definition, keeping the layer's own id/visible/opacity/blendMode", () => {
    const paint: Paint = {
      id: "p1",
      type: "solid",
      color: "#000000", // stale inline fallback value
      styleId: "fs1",
      opacity: 0.5,
      visible: true,
      blendMode: "multiply",
    };
    const resolved = resolveFillStylePaint(paint, fillStyles);
    expect(resolved).toMatchObject({
      id: "p1",
      type: "solid",
      color: "#3366ff",
      opacity: 0.5,
      visible: true,
      blendMode: "multiply",
      styleId: "fs1",
    });
  });

  it("falls back to the layer's own inline value when the style is missing (dangling reference)", () => {
    const paint: Paint = { id: "p1", type: "solid", color: "#abcdef", styleId: "does-not-exist" };
    expect(resolveFillStylePaint(paint, fillStyles)).toBe(paint);
  });

  it("a style paint can be a gradient, replacing the layer's inline solid entirely", () => {
    const gradientStyles: FillStyle[] = [
      {
        id: "fs2",
        name: "Sunset",
        paint: {
          id: "g",
          type: "gradient",
          gradient: {
            type: "linear",
            stops: [{ color: "#ff0000", position: 0 }, { color: "#0000ff", position: 1 }],
            startX: 0,
            startY: 0,
            endX: 1,
            endY: 1,
          },
        },
      },
    ];
    const paint: Paint = { id: "p1", type: "solid", color: "#000000", styleId: "fs2" };
    const resolved = resolveFillStylePaint(paint, gradientStyles);
    expect(resolved.type).toBe("gradient");
  });
});

describe("getResolvedRenderableFills", () => {
  const fillStyles: FillStyle[] = [
    { id: "fs1", name: "Brand", paint: { id: "style-paint", type: "solid", color: "#3366ff" } },
  ];

  it("resolves style references within the node's renderable fill stack", () => {
    const node = makeNode({
      fills: [{ id: "p1", type: "solid", color: "#000000", styleId: "fs1" }],
    });
    const resolved = getResolvedRenderableFills(node, fillStyles);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({ color: "#3366ff" });
  });

  it("skips invisible/zero-opacity layers same as getRenderableFills", () => {
    const node = makeNode({
      fills: [
        { id: "p1", type: "solid", color: "#ff0000", visible: false },
        { id: "p2", type: "solid", color: "#00ff00", styleId: "fs1" },
      ],
    });
    const resolved = getResolvedRenderableFills(node, fillStyles);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].id).toBe("p2");
  });
});

describe("resolveEffectStack", () => {
  const effectStyles: EffectStyle[] = [
    {
      id: "es1",
      name: "Card shadow",
      effects: [
        { type: "shadow", shadowType: "outer", color: "#00000040", offset: { x: 0, y: 4 }, blur: 8, spread: 0, id: "e1" },
      ],
    },
  ];

  it("falls back to the node's own effects when effectStyleId is unset", () => {
    const node = makeNode({
      effects: [{ type: "blur", radius: 4, id: "b1" }],
    });
    expect(resolveEffectStack(node, effectStyles)).toEqual(node.effects);
  });

  it("sources the whole stack from the referenced effect style when effectStyleId is set", () => {
    const node = makeNode({
      effectStyleId: "es1",
      effects: [{ type: "blur", radius: 4, id: "b1" }], // ignored while the style reference is live
    });
    const resolved = resolveEffectStack(node, effectStyles);
    expect(resolved).toEqual(effectStyles[0].effects);
  });

  it("falls back to the node's own effects when the referenced style is missing", () => {
    const node = makeNode({
      effectStyleId: "does-not-exist",
      effects: [{ type: "blur", radius: 4, id: "b1" }],
    });
    expect(resolveEffectStack(node, effectStyles)).toEqual(node.effects);
  });

  it("filters out invisible effects from the style's stack", () => {
    const hiddenStyles: EffectStyle[] = [
      {
        id: "es2",
        name: "Hidden",
        effects: [{ type: "blur", radius: 4, id: "b1", visible: false }],
      },
    ];
    const node = makeNode({ effectStyleId: "es2" });
    expect(resolveEffectStack(node, hiddenStyles)).toEqual([]);
  });
});

describe("style → variable → theme resolution chain", () => {
  const variables: Variable[] = [
    {
      id: "var-brand",
      name: "--brand",
      type: "color",
      value: "#3366ff",
      themeValues: { light: "#3366ff", dark: "#99bbff" },
    },
  ];

  it("a fill style whose solid paint carries a colorBinding resolves through the variable's theme value", () => {
    const fillStyles: FillStyle[] = [
      {
        id: "fs1",
        name: "Brand",
        paint: { id: "style-paint", type: "solid", color: "#000000", colorBinding: { variableId: "var-brand" } },
      },
    ];
    const paint: Paint = { id: "p1", type: "solid", color: "#111111", styleId: "fs1" };

    // Step 1: style resolution substitutes the style's paint (carrying its own colorBinding).
    const styleResolved = resolveFillStylePaint(paint, fillStyles);
    expect(styleResolved.type).toBe("solid");
    expect((styleResolved as { colorBinding?: { variableId: string } }).colorBinding).toEqual({
      variableId: "var-brand",
    });

    // Step 2: the existing variable-resolution primitive (used by getResolvedSolidPaint in the
    // Pixi layer) resolves that colorBinding against the active theme — light and dark differ.
    const solid = styleResolved as { color: string; colorBinding?: { variableId: string } };
    expect(resolveColor(solid.color, solid.colorBinding, variables, "light")).toBe("#3366ff");
    expect(resolveColor(solid.color, solid.colorBinding, variables, "dark")).toBe("#99bbff");
  });

  it("an effect style's shadow colorBinding resolves through the variable's theme value", () => {
    const effectStyles: EffectStyle[] = [
      {
        id: "es1",
        name: "Brand shadow",
        effects: [
          {
            type: "shadow",
            shadowType: "outer",
            color: "#00000040",
            colorBinding: { variableId: "var-brand" },
            offset: { x: 0, y: 4 },
            blur: 8,
            spread: 0,
            id: "e1",
          },
        ],
      },
    ];
    const node = makeNode({ effectStyleId: "es1" });
    const [shadow] = resolveEffectStack(node, effectStyles) as ShadowEffect[];
    expect(shadow.colorBinding).toEqual({ variableId: "var-brand" });
    expect(resolveColor(shadow.color, shadow.colorBinding, variables, "light")).toBe("#3366ff");
    expect(resolveColor(shadow.color, shadow.colorBinding, variables, "dark")).toBe("#99bbff");
  });

  it("a dangling style reference falls back to the inline paint, not the variable chain", () => {
    const paint: Paint = {
      id: "p1",
      type: "solid",
      color: "#deadbe",
      styleId: "missing-style",
    };
    const resolved = resolveFillStylePaint(paint, []);
    expect(resolved).toBe(paint);
    expect(resolveColor(resolved.type === "solid" ? resolved.color : undefined, undefined, variables, "light")).toBe(
      "#deadbe",
    );
  });
});
