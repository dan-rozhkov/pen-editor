import { describe, expect, it } from "vitest";
import type { FlatSceneNode } from "@/types/scene";
import { getComponentPropertyFieldOptions } from "@/utils/componentPropertyFields";

const textNode = { id: "text", type: "text" } as FlatSceneNode;
const frameNode = { id: "frame", type: "frame" } as FlatSceneNode;

describe("getComponentPropertyFieldOptions", () => {
  it("offers text and paint fields for string-valued properties on text layers", () => {
    expect(getComponentPropertyFieldOptions(textNode, "text")).toEqual([
      { value: "text", label: "Text" },
      { value: "fill", label: "Fill" },
      { value: "stroke", label: "Stroke" },
    ]);
  });

  it("offers boolean fields, including frame-specific fields", () => {
    expect(getComponentPropertyFieldOptions(frameNode, "boolean").map((option) => option.value)).toEqual([
      "visible",
      "enabled",
      "flipX",
      "flipY",
      "absolutePosition",
      "isMask",
      "clip",
      "isSlot",
    ]);
  });
});
