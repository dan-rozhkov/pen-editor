import { afterEach, describe, expect, it } from "vitest";
import {
  getCanvasElement,
  getCanvasViewportCenter,
  getCanvasViewportMetrics,
} from "../canvasViewport";

describe("canvasViewport", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("falls back to window dimensions when no [data-canvas] element is mounted", () => {
    expect(getCanvasElement()).toBeNull();
    expect(getCanvasViewportMetrics()).toEqual({
      width: window.innerWidth,
      height: window.innerHeight,
    });
    expect(getCanvasViewportCenter()).toEqual({
      centerX: window.innerWidth / 2,
      centerY: window.innerHeight / 2,
    });
  });

  it("returns the mounted canvas element's client size", () => {
    const el = document.createElement("div");
    el.setAttribute("data-canvas", "");
    Object.defineProperty(el, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: 600, configurable: true });
    document.body.appendChild(el);

    expect(getCanvasElement()).toBe(el);
    expect(getCanvasViewportMetrics()).toEqual({ width: 800, height: 600 });
  });
});
