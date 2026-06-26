import { describe, it, expect } from "vitest";
import { embedScreenRect } from "../embedLayerGeometry";

describe("embedScreenRect", () => {
  it("maps world rect through scale + pan", () => {
    expect(embedScreenRect(100, 100, 200, 150, 2, 50, 50, 1)).toEqual({
      left: 250,
      top: 250,
      width: 400,
      height: 300,
    });
  });

  it("snaps to device pixels", () => {
    // absX*scale+panX = 10*1.5+0 = 15; with dpr=2 → round(30)/2 = 15
    const r = embedScreenRect(10, 10, 33, 33, 1.5, 0, 0, 2);
    expect(r.left).toBe(15);
    expect(r.width).toBe(Math.round(33 * 1.5 * 2) / 2); // 49.5
  });
});
