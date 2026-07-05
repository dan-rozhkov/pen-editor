import { describe, it, expect } from "vitest";
import { applyBaseProps } from "../styleApplication";
import type { RectNode } from "@/types/scene";

/**
 * Minimal CSSStyleDeclaration stub: applyBaseProps only reads string
 * properties and guards every parse, so missing fields may be undefined.
 */
function styleStub(props: Record<string, string>): CSSStyleDeclaration {
  return props as unknown as CSSStyleDeclaration;
}

function rect(): RectNode {
  return { id: "r1", type: "rect", x: 0, y: 0, width: 100, height: 100 };
}

describe("applyBaseProps — legacy single-background-layer path", () => {
  it("single radial-gradient background → legacy gradientFill with type radial", () => {
    const node = rect();
    applyBaseProps(
      node,
      styleStub({
        backgroundColor: "rgba(0, 0, 0, 0)",
        backgroundImage: "radial-gradient(rgb(255, 0, 0), rgb(0, 0, 255))",
        backgroundSize: "",
        backgroundBlendMode: "",
      }),
    );
    expect(node.fills).toBeUndefined(); // single layer stays on legacy fields
    expect(node.gradientFill).toBeDefined();
    expect(node.gradientFill!.type).toBe("radial");
    expect(node.gradientFill!.stops.map((s) => s.color)).toEqual(["#ff0000", "#0000ff"]);
  });

  it("single linear-gradient background still → legacy gradientFill", () => {
    const node = rect();
    applyBaseProps(
      node,
      styleStub({
        backgroundColor: "rgba(0, 0, 0, 0)",
        backgroundImage: "linear-gradient(90deg, rgb(255, 0, 0), rgb(0, 0, 255))",
        backgroundSize: "",
        backgroundBlendMode: "",
      }),
    );
    expect(node.fills).toBeUndefined();
    expect(node.gradientFill?.type).toBe("linear");
  });

  it("single image with background-size 100% 100% → legacy imageFill stretch", () => {
    const node = rect();
    applyBaseProps(
      node,
      styleStub({
        backgroundColor: "rgba(0, 0, 0, 0)",
        backgroundImage: 'url("http://x/y.png")',
        backgroundSize: "100% 100%",
        backgroundBlendMode: "",
      }),
    );
    expect(node.fills).toBeUndefined();
    expect(node.imageFill).toEqual({ url: "http://x/y.png", mode: "stretch" });
  });

  it("single image with background-size contain → legacy imageFill fit", () => {
    const node = rect();
    applyBaseProps(
      node,
      styleStub({
        backgroundColor: "rgba(0, 0, 0, 0)",
        backgroundImage: 'url("http://x/y.png")',
        backgroundSize: "contain",
        backgroundBlendMode: "",
      }),
    );
    expect(node.imageFill).toEqual({ url: "http://x/y.png", mode: "fit" });
  });
});

describe("applyBaseProps — corner radius", () => {
  it("uniform border-radius → single cornerRadius, no per-corner", () => {
    const node = rect();
    applyBaseProps(
      node,
      styleStub({
        borderTopLeftRadius: "8px",
        borderTopRightRadius: "8px",
        borderBottomRightRadius: "8px",
        borderBottomLeftRadius: "8px",
      }),
    );
    expect(node.cornerRadius).toBe(8);
    expect(node.cornerRadiusPerCorner).toBeUndefined();
  });

  it("mixed border-radius → cornerRadiusPerCorner, no unified value", () => {
    const node = rect();
    applyBaseProps(
      node,
      styleStub({
        borderTopLeftRadius: "12px",
        borderTopRightRadius: "8px",
        borderBottomRightRadius: "4px",
        borderBottomLeftRadius: "0px",
      }),
    );
    expect(node.cornerRadius).toBeUndefined();
    expect(node.cornerRadiusPerCorner).toEqual({
      topLeft: 12,
      topRight: 8,
      bottomRight: 4,
      bottomLeft: undefined,
    });
  });

  it("no border-radius → neither field set", () => {
    const node = rect();
    applyBaseProps(node, styleStub({}));
    expect(node.cornerRadius).toBeUndefined();
    expect(node.cornerRadiusPerCorner).toBeUndefined();
  });
});

describe("applyBaseProps — box-shadow + filter blur → effects stack", () => {
  it("shadow + blur → effects of length 2, [shadow, blur], no legacy single effect", () => {
    const node = rect();
    applyBaseProps(
      node,
      styleStub({
        boxShadow: "2px 4px 6px rgba(0,0,0,0.25)",
        filter: "blur(6px)",
      }),
    );
    expect(node.effect).toBeUndefined();
    expect(node.effects).toHaveLength(2);
    expect(node.effects![0].type).toBe("shadow");
    expect(node.effects![1]).toEqual({ type: "blur", radius: 6 });
  });

  it("blur only, no box-shadow → effects [blur], no legacy single effect", () => {
    const node = rect();
    applyBaseProps(
      node,
      styleStub({
        filter: "blur(5px)",
      }),
    );
    expect(node.effect).toBeUndefined();
    expect(node.effects).toEqual([{ type: "blur", radius: 5 }]);
  });
});
