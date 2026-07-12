import { describe, expect, it } from "vitest";
import {
  OUTLINE_STROKE_COLOR,
  getOutlineStrokeColor,
} from "../outlineHelpers";
import { COMPONENT_SELECTION_COLOR } from "@/pixi/selectionOverlay/constants";

describe("outline helpers", () => {
  it("uses the component palette color for reusable frame outlines", () => {
    expect(getOutlineStrokeColor({ reusable: true })).toBe(COMPONENT_SELECTION_COLOR);
  });

  it("keeps regular node outlines on the default palette color", () => {
    expect(getOutlineStrokeColor({ reusable: false })).toBe(OUTLINE_STROKE_COLOR);
    expect(getOutlineStrokeColor()).toBe(OUTLINE_STROKE_COLOR);
  });
});
