import { describe, it, expect } from "vitest";
import { pickTextStyleProperties, TEXT_STYLE_PROPERTY_KEYS } from "../textStyle";

describe("TEXT_STYLE_PROPERTY_KEYS", () => {
  it("includes fontVariations alongside the other typography keys", () => {
    expect(TEXT_STYLE_PROPERTY_KEYS).toContain("fontVariations");
  });

  it("includes fontFeatures alongside the other typography keys", () => {
    expect(TEXT_STYLE_PROPERTY_KEYS).toContain("fontFeatures");
  });
});

describe("pickTextStyleProperties: fontVariations", () => {
  it("picks a valid axis-value record", () => {
    const props = pickTextStyleProperties({ fontVariations: { wght: 530, opsz: 24 } });
    expect(props.fontVariations).toEqual({ wght: 530, opsz: 24 });
  });

  it("omits fontVariations when absent", () => {
    const props = pickTextStyleProperties({ fontSize: 16 });
    expect(props.fontVariations).toBeUndefined();
  });

  it("rejects a non-object value", () => {
    const props = pickTextStyleProperties({ fontVariations: "wght:530" });
    expect(props.fontVariations).toBeUndefined();
  });

  it("rejects an array value", () => {
    const props = pickTextStyleProperties({ fontVariations: [530] });
    expect(props.fontVariations).toBeUndefined();
  });

  it("rejects an object with a non-numeric axis value", () => {
    const props = pickTextStyleProperties({ fontVariations: { wght: "bold" } });
    expect(props.fontVariations).toBeUndefined();
  });

  it("accepts an empty object (no axes set)", () => {
    const props = pickTextStyleProperties({ fontVariations: {} });
    expect(props.fontVariations).toEqual({});
  });
});

describe("pickTextStyleProperties: fontFeatures", () => {
  it("picks a valid feature-tag record", () => {
    const props = pickTextStyleProperties({ fontFeatures: { dlig: 1, tnum: 1 } });
    expect(props.fontFeatures).toEqual({ dlig: 1, tnum: 1 });
  });

  it("omits fontFeatures when absent", () => {
    const props = pickTextStyleProperties({ fontSize: 16 });
    expect(props.fontFeatures).toBeUndefined();
  });

  it("rejects a non-object value", () => {
    const props = pickTextStyleProperties({ fontFeatures: "dlig:1" });
    expect(props.fontFeatures).toBeUndefined();
  });

  it("rejects an array value", () => {
    const props = pickTextStyleProperties({ fontFeatures: [1] });
    expect(props.fontFeatures).toBeUndefined();
  });

  it("rejects an object with a non-numeric feature value", () => {
    const props = pickTextStyleProperties({ fontFeatures: { dlig: "on" } });
    expect(props.fontFeatures).toBeUndefined();
  });

  it("accepts an empty object (no features set)", () => {
    const props = pickTextStyleProperties({ fontFeatures: {} });
    expect(props.fontFeatures).toEqual({});
  });
});
