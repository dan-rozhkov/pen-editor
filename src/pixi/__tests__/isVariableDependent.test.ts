import { describe, it, expect } from "vitest";
import type { FlatSceneNode } from "@/types/scene";
import { isVariableDependent } from "@/pixi/pixiSync";

const node = (props: Record<string, unknown>): FlatSceneNode =>
  props as unknown as FlatSceneNode;

describe("isVariableDependent", () => {
  it("treats ref nodes as variable-dependent (subtree may contain bindings)", () => {
    expect(isVariableDependent(node({ type: "ref" }))).toBe(true);
  });

  it("treats embed nodes as variable-dependent (variables injected as CSS)", () => {
    expect(isVariableDependent(node({ type: "embed" }))).toBe(true);
  });

  it("is true when a fillBinding is present", () => {
    expect(
      isVariableDependent(node({ type: "rect", fillBinding: { variableId: "v1" } })),
    ).toBe(true);
  });

  it("is true when a strokeBinding is present", () => {
    expect(
      isVariableDependent(node({ type: "ellipse", strokeBinding: { variableId: "v1" } })),
    ).toBe(true);
  });

  it("is false for a plain node with no bindings", () => {
    expect(isVariableDependent(node({ type: "rect", fill: "#123456" }))).toBe(false);
  });

  it("is false when binding fields are null/undefined", () => {
    expect(
      isVariableDependent(node({ type: "text", fillBinding: null, strokeBinding: undefined })),
    ).toBe(false);
  });
});
