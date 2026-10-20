import { describe, expect, it } from "vitest";
import {
  addColumnBar,
  addRowBar,
  BAR_GAP,
  BAR_SIZE,
  columnGrip,
  GRIP_LENGTH,
  GRIP_THICKNESS,
  hoveredCell,
  isTableControl,
  relativeTo,
  ROW_GRIP_OVERHANG,
  rowGrip,
  visibleSpan,
} from "../tableGeometry";

function build(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
}

const TABLE = `<table><tbody>
  <tr><th id="h0">A</th><th id="h1">B</th></tr>
  <tr><td id="c00"><p id="p00">x</p></td><td id="c01">y</td></tr>
  <tr><td id="c10">z</td><td id="c11">w</td></tr>
</tbody></table><p id="outside">t</p>`;

describe("hoveredCell", () => {
  const host = build(TABLE);
  const at = (id: string) => hoveredCell(host.querySelector(`#${id}`));

  it.each([
    ["h0", 0, 0],
    ["h1", 0, 1],
    ["c00", 1, 0],
    ["p00", 1, 0],
    ["c01", 1, 1],
    ["c11", 2, 1],
  ])("%s is row %s col %s", (id, row, col) => {
    expect(at(id)).toMatchObject({ row, col });
  });

  it("returns the table element", () => {
    expect(at("c10")?.table).toBe(host.querySelector("table"));
  });

  it("is null outside a table and for a missing target", () => {
    expect(at("outside")).toBeNull();
    expect(hoveredCell(null)).toBeNull();
  });
});

describe("isTableControl", () => {
  it("matches the controls and their children only", () => {
    const host = build(`<div data-table-control><svg id="icon"></svg></div><p id="other"></p>`);
    expect(isTableControl(host.querySelector("#icon"))).toBe(true);
    expect(isTableControl(host.querySelector("#other"))).toBe(false);
    expect(isTableControl(null)).toBe(false);
  });
});

describe("relativeTo", () => {
  it("shifts a rect into container space", () => {
    expect(relativeTo({ left: 150, top: 220, right: 250, bottom: 260 }, { left: 100, top: 200, right: 900, bottom: 900 })).toEqual({
      left: 50,
      top: 20,
      right: 150,
      bottom: 60,
    });
  });
});

describe("visibleSpan", () => {
  it("is the table when it fits the wrapper", () => {
    expect(visibleSpan({ left: 0, top: 0, right: 300, bottom: 1 }, { left: 0, top: 0, right: 700, bottom: 1 })).toEqual({ left: 0, right: 300 });
  });
  it("is clipped to the wrapper when the table scrolls", () => {
    expect(visibleSpan({ left: -200, top: 0, right: 900, bottom: 1 }, { left: 0, top: 0, right: 700, bottom: 1 })).toEqual({ left: 0, right: 700 });
  });
});

describe("rowGrip", () => {
  it("centres on the row and stays clear of the block handle", () => {
    const grip = rowGrip({ left: 0, top: 40, right: 500, bottom: 80 }, { left: 0 });
    expect(grip.top + grip.height / 2).toBe(60);
    expect(grip.left).toBe(-ROW_GRIP_OVERHANG);
    expect(grip.left).toBeGreaterThan(-6);
    expect(grip.width).toBe(GRIP_THICKNESS);
  });
  it("follows the visible left edge of a scrolled table", () => {
    expect(rowGrip({ left: -80, top: 0, right: 400, bottom: 30 }, { left: 0 }).left).toBe(-ROW_GRIP_OVERHANG);
  });
});

describe("columnGrip", () => {
  const visible = { left: 0, right: 700 };
  it("centres on the column and straddles the top border", () => {
    const grip = columnGrip({ left: 120, top: 0, right: 240, bottom: 30 }, 10, visible);
    expect(grip).toEqual({ left: 180 - GRIP_LENGTH / 2, top: 10 - GRIP_THICKNESS / 2, width: GRIP_LENGTH, height: GRIP_THICKNESS });
  });
  it("is hidden when the column centre is scrolled out of view", () => {
    expect(columnGrip({ left: 800, top: 0, right: 920, bottom: 30 }, 0, visible)).toBeNull();
    expect(columnGrip({ left: -200, top: 0, right: -80, bottom: 30 }, 0, visible)).toBeNull();
  });
});

describe("add bars", () => {
  const table = { left: 0, top: 10, right: 400, bottom: 130 };
  it("row bar spans the visible width just below the table", () => {
    expect(addRowBar(table, { left: 0, right: 400 })).toEqual({ left: 0, top: 130 + BAR_GAP, width: 400, height: BAR_SIZE });
  });
  it("column bar spans the table height just right of it", () => {
    expect(addColumnBar(table, { right: 400 }, 800)).toEqual({ left: 400 + BAR_GAP, top: 10, width: BAR_SIZE, height: 120 });
  });
  it("column bar never passes the limit (a scrolled-wide table)", () => {
    expect(addColumnBar(table, { right: 800 }, 800).left).toBe(800 - BAR_SIZE);
  });
});
