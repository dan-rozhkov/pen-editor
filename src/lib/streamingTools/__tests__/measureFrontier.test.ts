import { describe, expect, it, vi } from "vitest";
import { measureFrontier } from "../measureFrontier";

function build(html: string): { root: HTMLElement; all: HTMLElement[] } {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return { root, all: Array.from(root.querySelectorAll<HTMLElement>("*")) };
}

function giveBox(el: HTMLElement, bottom: number): void {
  el.getBoundingClientRect = () =>
    ({ top: bottom - 10, bottom, left: 0, right: 100, width: 100, height: 10 }) as DOMRect;
}

describe("measureFrontier", () => {
  it("returns the bottom of the last in-flow leaf", () => {
    const { root, all } = build('<p id="a">a</p><p id="b">b</p>');
    giveBox(all[0], 40);
    giveBox(all[1], 90);
    expect(measureFrontier(all, 10, root)).toBe(80);
    root.remove();
  });

  it("skips a leaf whose ANCESTOR is absolutely positioned", () => {
    const { root, all } = build(
      '<p id="a">a</p><nav style="position:absolute;bottom:28px"><span id="s">tab</span></nav>',
    );
    const [a, nav, span] = all;
    giveBox(a, 40);
    giveBox(nav, 500);
    giveBox(span, 500);
    expect(measureFrontier(all, 0, root)).toBe(40);
    root.remove();
  });

  it("skips the leaf itself when out of flow and fixed/sticky ancestors", () => {
    const { root, all } = build(
      '<p id="a">a</p><div style="position:fixed"><div><b>x</b></div></div><i style="position:sticky">s</i>',
    );
    all.forEach((el, i) => giveBox(el, i === 0 ? 30 : 700));
    expect(measureFrontier(all, 0, root)).toBe(30);
    root.remove();
  });

  it("computes each ancestor's style once per measurement", () => {
    const { root, all } = build('<div><span>a</span><span>b</span><span>c</span></div>');
    all.forEach((el) => giveBox(el, 20));
    const spy = vi.spyOn(window, "getComputedStyle");
    measureFrontier(all, 0, root);
    // leaf styles (1: last span accepted) + ancestor chain: span + div = 2 more.
    expect(spy.mock.calls.length).toBeLessThanOrEqual(3);
    spy.mockRestore();
    root.remove();
  });
});
