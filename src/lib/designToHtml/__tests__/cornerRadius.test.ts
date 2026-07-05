import { describe, it, expect } from "vitest";
import { generateVisualStyles } from "../styleGeneration";
import type { RectNode } from "@/types/scene";

function rect(extra: Partial<RectNode>): RectNode {
  return {
    id: "r1",
    type: "rect",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    ...extra,
  };
}

describe("designToHtml corner radius", () => {
  it("unified cornerRadius → single-value border-radius", () => {
    const styles = generateVisualStyles(rect({ cornerRadius: 8 }));
    expect(styles["border-radius"]).toBe("8px");
  });

  it("per-corner radii → 4-value border-radius (tl tr br bl)", () => {
    const styles = generateVisualStyles(
      rect({
        cornerRadiusPerCorner: {
          topLeft: 12,
          topRight: 8,
          bottomRight: 4,
          bottomLeft: 0,
        },
      }),
    );
    expect(styles["border-radius"]).toBe("12px 8px 4px 0px");
  });

  it("per-corner takes precedence over a stale unified value", () => {
    const styles = generateVisualStyles(
      rect({
        cornerRadius: 20,
        cornerRadiusPerCorner: { topLeft: 6, bottomRight: 6 },
      }),
    );
    expect(styles["border-radius"]).toBe("6px 0px 6px 0px");
  });

  it("missing per-corner keys default to 0px", () => {
    const styles = generateVisualStyles(
      rect({ cornerRadiusPerCorner: { topLeft: 10 } }),
    );
    expect(styles["border-radius"]).toBe("10px 0px 0px 0px");
  });

  it("no radius → no border-radius emitted", () => {
    const styles = generateVisualStyles(rect({}));
    expect(styles["border-radius"]).toBeUndefined();
  });
});
