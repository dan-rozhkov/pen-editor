import { describe, it, expect } from "vitest";
import { generateLayoutStyles } from "../layoutStyleGeneration";
import type { FlatFrameNode, FlatSceneNode } from "@/types/scene";

function frame(layout: Record<string, unknown>): FlatFrameNode {
  return {
    id: "f1",
    type: "frame",
    x: 0,
    y: 0,
    width: 300,
    height: 100,
    children: [],
    layout: { autoLayout: true, ...layout },
  } as unknown as FlatFrameNode;
}

function rect(extra: Partial<FlatSceneNode> = {}): FlatSceneNode {
  return {
    id: "r1",
    type: "rect",
    x: 0,
    y: 0,
    width: 50,
    height: 40,
    ...extra,
  } as unknown as FlatSceneNode;
}

describe("designToHtml layout: flex-wrap / gap", () => {
  it("emits flex-wrap: wrap when the frame has wrap enabled", () => {
    const styles = generateLayoutStyles(frame({ flexWrap: true }), undefined, true);
    expect(styles["flex-wrap"]).toBe("wrap");
  });

  it("omits flex-wrap when wrap is off", () => {
    const styles = generateLayoutStyles(frame({}), undefined, true);
    expect(styles["flex-wrap"]).toBeUndefined();
  });

  it("uses the single gap shorthand when rowGap/columnGap are unset", () => {
    const styles = generateLayoutStyles(frame({ gap: 12 }), undefined, true);
    expect(styles.gap).toBe("12px");
    expect(styles["row-gap"]).toBeUndefined();
    expect(styles["column-gap"]).toBeUndefined();
  });

  it("emits separate row-gap/column-gap when set independently", () => {
    const styles = generateLayoutStyles(
      frame({ flexWrap: true, rowGap: 24, columnGap: 16 }),
      undefined,
      true,
    );
    expect(styles["row-gap"]).toBe("24px");
    expect(styles["column-gap"]).toBe("16px");
    expect(styles.gap).toBeUndefined();
  });

  it("falls back to gap for the unset axis when only one of rowGap/columnGap is set", () => {
    const styles = generateLayoutStyles(
      frame({ flexWrap: true, gap: 8, columnGap: 20 }),
      undefined,
      true,
    );
    expect(styles["row-gap"]).toBe("8px"); // falls back to gap
    expect(styles["column-gap"]).toBe("20px");
  });
});

describe("designToHtml layout: min/max width/height", () => {
  it("emits min-width/max-width/min-height/max-height for a flex child with sizing clamps", () => {
    const parentLayout = { autoLayout: true, flexDirection: "row" as const };
    const child = rect({
      sizing: { minWidth: 50, maxWidth: 300, minHeight: 20, maxHeight: 150 },
    });
    const styles = generateLayoutStyles(child, parentLayout, false);
    expect(styles["min-width"]).toBe("50px");
    expect(styles["max-width"]).toBe("300px");
    expect(styles["min-height"]).toBe("20px");
    expect(styles["max-height"]).toBe("150px");
  });

  it("an explicit minWidth overrides the fill_container min-width:0 reset", () => {
    const parentLayout = { autoLayout: true, flexDirection: "row" as const };
    const child = rect({
      sizing: { widthMode: "fill_container", minWidth: 100 },
    });
    const styles = generateLayoutStyles(child, parentLayout, false);
    expect(styles["min-width"]).toBe("100px");
  });

  it("omits min/max styles when unset", () => {
    const parentLayout = { autoLayout: true, flexDirection: "row" as const };
    const styles = generateLayoutStyles(rect(), parentLayout, false);
    expect(styles["max-width"]).toBeUndefined();
    expect(styles["max-height"]).toBeUndefined();
  });
});
