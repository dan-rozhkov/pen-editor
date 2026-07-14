import { describe, it, expect } from "vitest";
import { groupGridChildrenIntoRows } from "../layoutInference";
import type { AutoLayoutResult } from "../layoutInference";
import type { FrameNode, RectNode } from "@/types/scene";

/**
 * Build a fake DOM element with `count` child elements whose
 * getBoundingClientRect is mocked per-child (position/size are otherwise
 * irrelevant to a real DOM — this element is never attached to document.body).
 */
function fakeGridEl(rects: { x: number; top: number; w: number; h: number }[]): Element {
  const el = document.createElement("div");
  for (const r of rects) {
    const child = document.createElement("div");
    Object.defineProperty(child, "getBoundingClientRect", {
      value: () => new DOMRect(r.x, r.top, r.w, r.h),
    });
    el.appendChild(child);
  }
  return el;
}

function rectNode(id: string, height: number): RectNode {
  return { id, type: "rect", x: 0, y: 0, width: 30, height };
}

function frameNode(children: RectNode[], width: number): FrameNode {
  return {
    id: "frame",
    type: "frame",
    x: 0,
    y: 0,
    width,
    height: 240,
    children,
    layout: { autoLayout: true, flexDirection: "column", gap: 14 },
  };
}

describe("groupGridChildrenIntoRows", () => {
  it("keeps a single visual row of 6 bar-chart cells as one row, despite differing tops (align-items: end)", () => {
    const children = [34, 47, 150, 222, 240, 120].map((h, i) => rectNode(`c${i}`, h));
    const frame = frameNode(children, 6 * 30 + 5 * 14);
    // Bottom-aligned bars: same bottom (240), different tops because heights differ.
    const rects = children.map((c, i) => ({ x: i * 44, top: 240 - c.height, w: 30, h: c.height }));
    const el = fakeGridEl(rects);
    const elementNodeMap = new Map<Element, RectNode>();
    Array.from(el.children).forEach((domChild, i) => elementNodeMap.set(domChild, children[i]));

    const grid: NonNullable<AutoLayoutResult["grid"]> = {
      colCount: 6,
      columnGap: 14,
      rowGap: 14,
      alignItems: "flex-end",
    };

    groupGridChildrenIntoRows(frame, el, grid, elementNodeMap);

    expect(frame.layout?.flexDirection).toBe("row");
    expect(frame.layout?.alignItems).toBe("flex-end");
    expect(frame.children).toHaveLength(6);
    expect(frame.children.every((c) => c.type === "rect")).toBe(true);
    // No "row" wrapper frames were introduced.
    expect(frame.children.some((c) => c.type === "frame")).toBe(false);
    expect(frame.children.map((c) => c.id)).toEqual(children.map((c) => c.id));
  });

  it("groups 6 cells into two rows of 3, in DOM order, for a genuine multi-row grid", () => {
    const children = Array.from({ length: 6 }, (_, i) => rectNode(`c${i}`, 40));
    const frame = frameNode(children, 3 * 30 + 2 * 14);
    // Two visual rows: tops 0 and 60 (row-aligned within each row).
    const rects = children.map((_, i) => ({
      x: (i % 3) * 44,
      top: i < 3 ? 0 : 60,
      w: 30,
      h: 40,
    }));
    const el = fakeGridEl(rects);
    const elementNodeMap = new Map<Element, RectNode>();
    Array.from(el.children).forEach((domChild, i) => elementNodeMap.set(domChild, children[i]));

    const grid: NonNullable<AutoLayoutResult["grid"]> = {
      colCount: 3,
      columnGap: 14,
      rowGap: 14,
      alignItems: "stretch",
    };

    groupGridChildrenIntoRows(frame, el, grid, elementNodeMap);

    expect(frame.children).toHaveLength(2);
    expect(frame.children.every((c) => c.type === "frame")).toBe(true);
    const rowFrames = frame.children as FrameNode[];
    expect(rowFrames[0].children.map((c) => c.id)).toEqual(["c0", "c1", "c2"]);
    expect(rowFrames[1].children.map((c) => c.id)).toEqual(["c3", "c4", "c5"]);
    expect(rowFrames[0].layout?.flexDirection).toBe("row");
  });
});
