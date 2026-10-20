import { afterEach, describe, expect, it } from "vitest";
import { keepInView } from "../keepInView";

const box = (el: HTMLElement, top: number, bottom: number) =>
  Object.defineProperty(el, "getBoundingClientRect", { value: () => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) });
const scrollable = (el: HTMLElement) => {
  el.style.overflowY = "auto";
  Object.defineProperty(el, "scrollHeight", { value: 500, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: 100, configurable: true });
};

describe("keepInView", () => {
  afterEach(() => document.body.replaceChildren());

  function setup(rowTop: number, rowBottom: number) {
    const outer = document.createElement("div");
    const list = document.createElement("div");
    const row = document.createElement("div");
    scrollable(outer);
    scrollable(list);
    outer.append(list);
    document.body.append(outer);
    list.append(row);
    box(list, 100, 200);
    box(row, rowTop, rowBottom);
    return { outer, list, row };
  }

  it("scrolls only the nearest scroll container, up or down", () => {
    const below = setup(190, 230);
    keepInView(below.row);
    expect(below.list.scrollTop).toBe(30);
    expect(below.outer.scrollTop).toBe(0);
    const above = setup(80, 120);
    above.list.scrollTop = 50;
    keepInView(above.row);
    expect(above.list.scrollTop).toBe(30);
  });

  it("stops at the first scrolling ancestor even when it does not overflow yet", () => {
    const box = setup(190, 230);
    Object.defineProperty(box.list, "scrollHeight", { value: 100 });
    keepInView(box.row);
    expect(box.outer.scrollTop).toBe(0);
  });

  it("scrolls sideways on the x axis", () => {
    const outer = document.createElement("div");
    const row = document.createElement("div");
    outer.style.overflowX = "auto";
    outer.append(row);
    document.body.append(outer);
    const rect = (left: number, right: number) => ({ value: () => ({ left, right, top: 0, bottom: 0, width: right - left, height: 0, x: left, y: 0, toJSON: () => ({}) }) });
    Object.defineProperty(outer, "getBoundingClientRect", rect(0, 100));
    Object.defineProperty(row, "getBoundingClientRect", rect(90, 130));
    keepInView(row, "x");
    expect(outer.scrollLeft).toBe(30);
  });

  it("leaves a visible row and a row without a scroller alone", () => {
    const inside = setup(120, 150);
    keepInView(inside.row);
    expect(inside.list.scrollTop).toBe(0);
    expect(() => keepInView(document.createElement("div"))).not.toThrow();
    expect(() => keepInView(null)).not.toThrow();
  });
});
