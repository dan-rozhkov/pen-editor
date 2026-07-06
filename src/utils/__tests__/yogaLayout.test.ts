import { describe, it, expect } from "vitest";
import {
  calculateFrameLayout,
  calculateFrameIntrinsicSize,
  calculateFrameIntrinsicHeight,
  applyLayoutToChildren,
  type LayoutResult,
} from "@/utils/yogaLayout";
import type { FrameNode, SceneNode } from "@/types/scene";

type Sizing = { widthMode?: string; heightMode?: string };

function rect(
  id: string,
  width: number,
  height: number,
  extra: Partial<SceneNode> & { sizing?: Sizing } = {},
): SceneNode {
  return {
    id,
    type: "rect",
    x: 0,
    y: 0,
    width,
    height,
    ...extra,
  } as unknown as SceneNode;
}

function frame(
  layout: Record<string, unknown>,
  size: { width: number; height: number },
  children: SceneNode[],
  extra: Record<string, unknown> = {},
): FrameNode {
  return {
    id: "f",
    type: "frame",
    x: 0,
    y: 0,
    width: size.width,
    height: size.height,
    layout: { autoLayout: true, ...layout },
    children,
    ...extra,
  } as unknown as FrameNode;
}

const byId = (results: LayoutResult[]): Record<string, LayoutResult> =>
  Object.fromEntries(results.map((r) => [r.id, r]));

describe("calculateFrameLayout", () => {
  it("returns [] for a non-auto-layout frame", () => {
    const f = frame({ autoLayout: false }, { width: 300, height: 100 }, [
      rect("a", 50, 40),
    ]);
    expect(calculateFrameLayout(f)).toEqual([]);
  });

  it("returns [] when there are no visible children", () => {
    const f = frame({ flexDirection: "row" }, { width: 300, height: 100 }, [
      rect("a", 50, 40, { visible: false }),
      rect("b", 60, 40, { enabled: false } as Partial<SceneNode>),
    ]);
    expect(calculateFrameLayout(f)).toEqual([]);
  });

  it("lays children left-to-right in a row at flex-start", () => {
    const f = frame({ flexDirection: "row" }, { width: 300, height: 100 }, [
      rect("a", 50, 40),
      rect("b", 60, 40),
    ]);
    const r = byId(calculateFrameLayout(f));
    expect(r.a).toMatchObject({ x: 0, y: 0, width: 50, height: 40 });
    expect(r.b).toMatchObject({ x: 50, y: 0, width: 60, height: 40 });
  });

  it("inserts gap between items", () => {
    const f = frame({ flexDirection: "row", gap: 10 }, { width: 300, height: 100 }, [
      rect("a", 50, 40),
      rect("b", 60, 40),
    ]);
    const r = byId(calculateFrameLayout(f));
    expect(r.a.x).toBe(0);
    expect(r.b.x).toBe(60); // 50 + gap 10
  });

  it("offsets by padding (top/left)", () => {
    const f = frame(
      { flexDirection: "row", paddingLeft: 20, paddingTop: 5 },
      { width: 300, height: 100 },
      [rect("a", 50, 40)],
    );
    const r = byId(calculateFrameLayout(f));
    expect(r.a).toMatchObject({ x: 20, y: 5 });
  });

  it("stacks children vertically in a column", () => {
    const f = frame(
      { flexDirection: "column", gap: 8 },
      { width: 100, height: 300 },
      [rect("a", 50, 40), rect("b", 50, 30)],
    );
    const r = byId(calculateFrameLayout(f));
    expect(r.a).toMatchObject({ x: 0, y: 0 });
    expect(r.b.y).toBe(48); // 40 + gap 8
  });

  it("excludes invisible / disabled / absolute children from results", () => {
    const f = frame({ flexDirection: "row" }, { width: 300, height: 100 }, [
      rect("a", 50, 40),
      rect("b", 50, 40, { visible: false }),
      rect("c", 50, 40, { absolutePosition: true } as Partial<SceneNode>),
    ]);
    const results = calculateFrameLayout(f);
    expect(results.map((r) => r.id)).toEqual(["a"]);
  });

  describe("justify-content (main axis)", () => {
    // container width 300, two 50-wide items, no gap -> freeSpace 200
    const mk = (justifyContent: string) =>
      byId(
        calculateFrameLayout(
          frame({ flexDirection: "row", justifyContent }, { width: 300, height: 100 }, [
            rect("a", 50, 40),
            rect("b", 50, 40),
          ]),
        ),
      );

    it("flex-end pushes items to the end", () => {
      const r = mk("flex-end");
      expect(r.a.x).toBe(200);
      expect(r.b.x).toBe(250);
    });

    it("center centers the group", () => {
      const r = mk("center");
      expect(r.a.x).toBe(100);
      expect(r.b.x).toBe(150);
    });

    it("space-between spreads to the edges", () => {
      const r = mk("space-between");
      expect(r.a.x).toBe(0);
      expect(r.b.x).toBe(250);
    });

    it("space-around distributes equal space around each item", () => {
      const r = mk("space-around");
      expect(r.a.x).toBeCloseTo(50); // perSlot 100, half = 50
      expect(r.b.x).toBeCloseTo(200); // 50 + 50 + perSlot 100
    });

    it("space-evenly distributes equal gaps including edges", () => {
      const r = mk("space-evenly");
      expect(r.a.x).toBeCloseTo(200 / 3); // perSlot for 3 slots
      expect(r.b.x).toBeCloseTo(200 / 3 + 50 + 200 / 3);
    });
  });

  describe("align-items (cross axis)", () => {
    const mk = (alignItems: string) =>
      byId(
        calculateFrameLayout(
          frame({ flexDirection: "row", alignItems }, { width: 300, height: 100 }, [
            rect("a", 50, 40),
          ]),
        ),
      );

    it("flex-start aligns to the cross start", () => {
      expect(mk("flex-start").a.y).toBe(0);
    });

    it("center centers on the cross axis", () => {
      expect(mk("center").a.y).toBe(30); // (100 - 40) / 2
    });

    it("flex-end aligns to the cross end", () => {
      expect(mk("flex-end").a.y).toBe(60); // 100 - 40
    });

    it("stretch fills the cross axis", () => {
      const r = mk("stretch");
      expect(r.a.y).toBe(0);
      expect(r.a.height).toBe(100);
    });
  });

  describe("flex-grow (fill_container main axis)", () => {
    it("grows a single fill child to the content width", () => {
      const f = frame({ flexDirection: "row" }, { width: 300, height: 100 }, [
        rect("a", 50, 40, { sizing: { widthMode: "fill_container" } }),
      ]);
      expect(byId(calculateFrameLayout(f)).a.width).toBe(300);
    });

    it("splits free space evenly between two fill children", () => {
      const f = frame({ flexDirection: "row" }, { width: 300, height: 100 }, [
        rect("a", 10, 40, { sizing: { widthMode: "fill_container" } }),
        rect("b", 10, 40, { sizing: { widthMode: "fill_container" } }),
      ]);
      const r = byId(calculateFrameLayout(f));
      expect(r.a.width).toBe(150);
      expect(r.b.width).toBe(150);
      expect(r.b.x).toBe(150);
    });

    it("gives remaining space to a fill child beside a fixed one", () => {
      const f = frame({ flexDirection: "row" }, { width: 300, height: 100 }, [
        rect("a", 50, 40),
        rect("b", 10, 40, { sizing: { widthMode: "fill_container" } }),
      ]);
      const r = byId(calculateFrameLayout(f));
      expect(r.a.width).toBe(50);
      expect(r.b.width).toBe(250);
      expect(r.b.x).toBe(50);
    });

    it("keeps fixed children at their size when they overflow (no shrink)", () => {
      const f = frame({ flexDirection: "row" }, { width: 100, height: 100 }, [
        rect("a", 80, 40),
        rect("b", 80, 40),
      ]);
      const r = byId(calculateFrameLayout(f));
      expect(r.a.width).toBe(80);
      expect(r.b.width).toBe(80);
      expect(r.b.x).toBe(80);
    });
  });
});

describe("flex-wrap", () => {
  it("keeps items on one line when wrap is off, even if they overflow", () => {
    const f = frame(
      { flexDirection: "row", gap: 10 },
      { width: 100, height: 100 },
      [rect("a", 60, 40), rect("b", 60, 40)],
    );
    const r = byId(calculateFrameLayout(f));
    expect(r.a).toMatchObject({ x: 0, y: 0 });
    expect(r.b).toMatchObject({ x: 70, y: 0 }); // still on the same row
  });

  it("wraps a second item onto a new row when it doesn't fit", () => {
    const f = frame(
      { flexDirection: "row", flexWrap: true, gap: 10 },
      { width: 100, height: 999 },
      [rect("a", 60, 40), rect("b", 60, 40)],
      { sizing: { heightMode: "fit_content" } },
    );
    const r = byId(calculateFrameLayout(f));
    expect(r.a).toMatchObject({ x: 0, y: 0 });
    expect(r.b).toMatchObject({ x: 0, y: 50 }); // new row: y = 40 (row 1 height) + rowGap 10
  });

  it("keeps items that fit on the same line", () => {
    const f = frame(
      { flexDirection: "row", flexWrap: true, gap: 10 },
      { width: 200, height: 999 },
      [rect("a", 60, 40), rect("b", 60, 40)],
      { sizing: { heightMode: "fit_content" } },
    );
    const r = byId(calculateFrameLayout(f));
    expect(r.a).toMatchObject({ x: 0, y: 0 });
    expect(r.b).toMatchObject({ x: 70, y: 0 });
  });

  it("uses rowGap/columnGap independently when wrapping in a row container", () => {
    const f = frame(
      { flexDirection: "row", flexWrap: true, rowGap: 20, columnGap: 5 },
      { width: 100, height: 999 },
      [rect("a", 60, 40), rect("b", 60, 40), rect("c", 60, 40)],
      { sizing: { heightMode: "fit_content" } },
    );
    const r = byId(calculateFrameLayout(f));
    // a and b each go on their own row (60+5+60=125 > 100)
    expect(r.a).toMatchObject({ x: 0, y: 0 });
    expect(r.b).toMatchObject({ x: 0, y: 60 }); // 40 + rowGap 20
    expect(r.c).toMatchObject({ x: 0, y: 120 }); // 60 + 40 + rowGap 20
  });

  it("wraps in a column container using columnGap between columns", () => {
    const f = frame(
      { flexDirection: "column", flexWrap: true, gap: 10 },
      { width: 999, height: 100 },
      [rect("a", 50, 60), rect("b", 50, 60)],
      { sizing: { widthMode: "fit_content" } },
    );
    const r = byId(calculateFrameLayout(f));
    expect(r.a).toMatchObject({ x: 0, y: 0 });
    expect(r.b).toMatchObject({ x: 60, y: 0 }); // new column: x = 50 (col width) + gap 10
  });

  it("grows fit-content height as children wrap onto more rows", () => {
    const wrapped = frame(
      { flexDirection: "row", flexWrap: true, gap: 10 },
      { width: 100, height: 999 },
      [rect("a", 60, 40), rect("b", 60, 30)],
      { sizing: { heightMode: "fit_content" } },
    );
    // Two rows: row1 height 40, row2 height 30, gap 10 between them
    expect(calculateFrameIntrinsicHeight(wrapped)).toBe(80);

    const singleRow = frame(
      { flexDirection: "row", flexWrap: true, gap: 10 },
      { width: 999, height: 999 },
      [rect("a", 60, 40), rect("b", 60, 30)],
      { sizing: { heightMode: "fit_content" } },
    );
    // Both items fit on one row -> height is just the row's max cross size
    expect(calculateFrameIntrinsicHeight(singleRow)).toBe(40);
  });

  it("distributes leftover cross space across lines when the container has a fixed cross size", () => {
    const f = frame(
      { flexDirection: "row", flexWrap: true, gap: 0, alignItems: "stretch" },
      { width: 100, height: 200 },
      [rect("a", 60, 40), rect("b", 60, 40)],
    );
    const r = byId(calculateFrameLayout(f));
    // naturals: 40 + 40 = 80, free space 120 split across 2 lines = 60 each
    expect(r.a.height).toBe(100);
    expect(r.b.height).toBe(100);
    expect(r.b.y).toBe(100);
  });
});

describe("min/max width/height clamps", () => {
  it("clamps a fixed-size child's width to maxWidth", () => {
    const f = frame({ flexDirection: "row" }, { width: 300, height: 100 }, [
      rect("a", 500, 40, { sizing: { maxWidth: 200 } }),
    ]);
    expect(byId(calculateFrameLayout(f)).a.width).toBe(200);
  });

  it("clamps a fixed-size child's width to minWidth", () => {
    const f = frame({ flexDirection: "row" }, { width: 300, height: 100 }, [
      rect("a", 10, 40, { sizing: { minWidth: 80 } }),
    ]);
    expect(byId(calculateFrameLayout(f)).a.width).toBe(80);
  });

  it("clamps a fill_container child's grown width to maxWidth", () => {
    const f = frame({ flexDirection: "row" }, { width: 300, height: 100 }, [
      rect("a", 10, 40, {
        sizing: { widthMode: "fill_container", maxWidth: 120 },
      }),
    ]);
    expect(byId(calculateFrameLayout(f)).a.width).toBe(120);
  });

  it("clamps a stretched child's cross size to maxHeight", () => {
    const f = frame(
      { flexDirection: "row", alignItems: "stretch" },
      { width: 300, height: 100 },
      [rect("a", 50, 40, { sizing: { maxHeight: 60 } })],
    );
    expect(byId(calculateFrameLayout(f)).a.height).toBe(60);
  });

  it("clamps min/max height for a fit_content column's hug height via minHeight on a child", () => {
    const f = frame({ flexDirection: "column" }, { width: 100, height: 300 }, [
      rect("a", 50, 10, { sizing: { minHeight: 40 } }),
    ]);
    expect(byId(calculateFrameLayout(f)).a.height).toBe(40);
  });
});

describe("calculateFrameIntrinsicSize", () => {
  it("returns frame size for a non-auto-layout frame", () => {
    const f = frame({ autoLayout: false }, { width: 300, height: 100 }, [
      rect("a", 50, 40),
    ]);
    expect(calculateFrameIntrinsicSize(f, { fitWidth: true })).toEqual({
      width: 300,
      height: 100,
    });
  });

  it("returns frame size when neither fit option is set", () => {
    const f = frame({ flexDirection: "row" }, { width: 300, height: 100 }, [
      rect("a", 50, 40),
    ]);
    expect(calculateFrameIntrinsicSize(f)).toEqual({ width: 300, height: 100 });
  });

  it("shrink-wraps width in a row, keeping height", () => {
    const f = frame(
      { flexDirection: "row", gap: 10, paddingLeft: 20, paddingRight: 20 },
      { width: 999, height: 100 },
      [rect("a", 50, 40), rect("b", 60, 40)],
    );
    const size = calculateFrameIntrinsicSize(f, { fitWidth: true });
    expect(size.width).toBe(160); // 50 + 60 + gap 10 + pad 40
    expect(size.height).toBe(100); // unchanged
  });

  it("shrink-wraps height in a column", () => {
    const f = frame(
      { flexDirection: "column", gap: 8, paddingTop: 5, paddingBottom: 5 },
      { width: 100, height: 999 },
      [rect("a", 50, 40), rect("b", 50, 30)],
    );
    const size = calculateFrameIntrinsicSize(f, { fitHeight: true });
    expect(size.height).toBe(88); // 40 + 30 + gap 8 + pad 10
  });

  it("uses the max cross size for the cross dimension", () => {
    const f = frame({ flexDirection: "row" }, { width: 999, height: 999 }, [
      rect("a", 50, 40),
      rect("b", 60, 70),
    ]);
    const size = calculateFrameIntrinsicSize(f, { fitWidth: true, fitHeight: true });
    expect(size.width).toBe(110);
    expect(size.height).toBe(70); // max(40, 70)
  });

  it("returns padding-only size when there are no visible children", () => {
    const f = frame(
      { flexDirection: "row", paddingLeft: 12, paddingRight: 8, paddingTop: 4, paddingBottom: 6 },
      { width: 300, height: 100 },
      [],
    );
    expect(calculateFrameIntrinsicSize(f, { fitWidth: true, fitHeight: true })).toEqual({
      width: 20,
      height: 10,
    });
  });
});

describe("calculateFrameIntrinsicHeight", () => {
  it("returns the fit-content height of a column", () => {
    const f = frame(
      { flexDirection: "column", gap: 10 },
      { width: 100, height: 999 },
      [rect("a", 50, 40), rect("b", 50, 50)],
    );
    expect(calculateFrameIntrinsicHeight(f)).toBe(100); // 40 + 50 + gap 10
  });
});

describe("applyLayoutToChildren", () => {
  it("applies position to all children and size only to non-fixed ones", () => {
    const children = [
      rect("a", 50, 40), // fixed -> keep size
      rect("b", 10, 10, { sizing: { widthMode: "fill_container", heightMode: "fill_container" } }),
    ];
    const results = [
      { id: "a", x: 5, y: 6, width: 999, height: 999 },
      { id: "b", x: 7, y: 8, width: 200, height: 100 },
    ];
    const out = applyLayoutToChildren(children, results);
    expect(out[0]).toMatchObject({ x: 5, y: 6, width: 50, height: 40 });
    expect(out[1]).toMatchObject({ x: 7, y: 8, width: 200, height: 100 });
  });

  it("returns children without a layout result untouched", () => {
    const a = rect("a", 50, 40);
    const out = applyLayoutToChildren([a], [{ id: "other", x: 1, y: 1, width: 1, height: 1 }]);
    expect(out[0]).toBe(a); // unchanged reference when no result matches
    expect(a).toMatchObject({ x: 0, y: 0, width: 50, height: 40 });
  });
});
