import { describe, expect, it } from "vitest";
import {
  OUTLINE_STROKE_COLOR,
  getOutlineStrokeColor,
  getOutlineStrokeWidth,
} from "../outlineHelpers";

describe("outline helpers", () => {
  it("returns the default palette color for node outlines", () => {
    expect(getOutlineStrokeColor()).toBe(OUTLINE_STROKE_COLOR);
  });

  it("keeps outline strokes at half a screen pixel", () => {
    expect(getOutlineStrokeWidth()).toBe(0.5);
  });
});
