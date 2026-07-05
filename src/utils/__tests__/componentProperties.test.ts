import { describe, it, expect } from "vitest";
import type { ComponentPropertyDef, FlatFrameNode, InstanceOverrideUpdateProps, RefNode } from "@/types/scene";
import {
  buildPropertyOverrides,
  getEffectiveOverrides,
  resolvePropertyValue,
  validatePropertyValue,
} from "@/utils/componentProperties";

function component(properties: ComponentPropertyDef[]): FlatFrameNode {
  return {
    id: "comp",
    type: "frame",
    name: "Comp",
    reusable: true,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    properties,
  } as unknown as FlatFrameNode;
}

function refNode(overrides?: RefNode["overrides"], propertyValues?: RefNode["propertyValues"]): RefNode {
  return {
    id: "inst",
    type: "ref",
    componentId: "comp",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    overrides,
    propertyValues,
  };
}

const variantProp: ComponentPropertyDef = {
  id: "state",
  name: "State",
  type: "variant",
  variantOptions: ["default", "hover", "pressed"],
  defaultValue: "default",
  bindingPath: "label",
  bindingProp: "text",
};

const booleanProp: ComponentPropertyDef = {
  id: "showIcon",
  name: "Show icon",
  type: "boolean",
  defaultValue: true,
  bindingPath: "icon",
  bindingProp: "visible",
};

const textProp: ComponentPropertyDef = {
  id: "label",
  name: "Label",
  type: "text",
  defaultValue: "Click me",
  bindingPath: "label",
  bindingProp: "text",
};

describe("resolvePropertyValue", () => {
  it("returns the selected value when present", () => {
    expect(resolvePropertyValue(variantProp, { state: "hover" })).toBe("hover");
  });

  it("falls back to the property's default when unset", () => {
    expect(resolvePropertyValue(variantProp, undefined)).toBe("default");
    expect(resolvePropertyValue(booleanProp, {})).toBe(true);
  });
});

describe("validatePropertyValue", () => {
  it("accepts a variant value that is one of the declared options", () => {
    expect(validatePropertyValue(variantProp, "pressed")).toBe(true);
  });

  it("rejects a variant value outside the declared options", () => {
    expect(validatePropertyValue(variantProp, "disabled")).toBe(false);
  });

  it("only accepts booleans for boolean properties", () => {
    expect(validatePropertyValue(booleanProp, true)).toBe(true);
    expect(validatePropertyValue(booleanProp, "true")).toBe(false);
  });

  it("only accepts strings for text properties", () => {
    expect(validatePropertyValue(textProp, "hello")).toBe(true);
    expect(validatePropertyValue(textProp, true)).toBe(false);
  });
});

describe("buildPropertyOverrides", () => {
  it("builds one update override per binding path from the resolved property values", () => {
    const overrides = buildPropertyOverrides([booleanProp, textProp], { label: "Buy now" });
    expect(overrides).toEqual({
      icon: { kind: "update", props: { visible: true } },
      label: { kind: "update", props: { text: "Buy now" } },
    });
  });

  it("merges multiple properties that target the same binding path", () => {
    const secondPropAtSamePath: ComponentPropertyDef = {
      id: "labelColor",
      name: "Label color",
      type: "text",
      defaultValue: "#000000",
      bindingPath: "label",
      bindingProp: "fill",
    };
    const overrides = buildPropertyOverrides([textProp, secondPropAtSamePath], {});
    expect(overrides.label).toEqual({
      kind: "update",
      props: { text: "Click me", fill: "#000000" },
    });
  });

  it("returns an empty object when there are no properties", () => {
    expect(buildPropertyOverrides(undefined, {})).toEqual({});
  });
});

describe("getEffectiveOverrides", () => {
  it("applies property-derived overrides when the instance has no explicit overrides", () => {
    const comp = component([booleanProp, textProp]);
    const ref = refNode(undefined, { showIcon: false });
    const effective = getEffectiveOverrides(comp, ref);
    expect(effective.icon).toEqual({ kind: "update", props: { visible: false } });
    expect(effective.label).toEqual({ kind: "update", props: { text: "Click me" } });
  });

  it("lets an explicit instance override at the same path win over the property-derived one", () => {
    const comp = component([textProp]);
    const ref = refNode(
      { label: { kind: "update", props: { text: "Explicit override" } as InstanceOverrideUpdateProps } },
      { label: "From property" },
    );
    const effective = getEffectiveOverrides(comp, ref);
    expect(effective.label).toEqual({ kind: "update", props: { text: "Explicit override" } });
  });

  it("preserves explicit overrides at paths the component has no property for", () => {
    const comp = component([booleanProp]);
    const ref = refNode({ unrelatedPath: { kind: "update", props: { fill: "#ff0000" } } }, { showIcon: false });
    const effective = getEffectiveOverrides(comp, ref);
    expect(effective.icon).toEqual({ kind: "update", props: { visible: false } });
    expect(effective.unrelatedPath).toEqual({ kind: "update", props: { fill: "#ff0000" } });
  });

  it("returns the ref's plain overrides untouched when the component declares no properties", () => {
    const comp = { ...component([]), properties: undefined };
    const ref = refNode({ label: { kind: "update", props: { text: "hi" } as InstanceOverrideUpdateProps } });
    expect(getEffectiveOverrides(comp, ref)).toEqual(ref.overrides);
  });
});
