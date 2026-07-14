import { describe, it, expect } from "vitest";
import {
  OPEN_TYPE_TOGGLE_FEATURES,
  OPEN_TYPE_SELECT_GROUPS,
  toFontFeatureSettingsCss,
  withoutStylisticSetFeatures,
  withToggleFeature,
  getGroupSelection,
  withGroupSelection,
} from "../openTypeFeatures";

describe("toFontFeatureSettingsCss", () => {
  it("returns undefined when fontFeatures is unset", () => {
    expect(toFontFeatureSettingsCss(undefined)).toBeUndefined();
  });

  it("returns undefined for an empty fontFeatures object", () => {
    expect(toFontFeatureSettingsCss({})).toBeUndefined();
  });

  it("emits a single-tag font-feature-settings value", () => {
    expect(toFontFeatureSettingsCss({ dlig: 1 })).toBe('"dlig" 1');
  });

  it("emits a multi-tag font-feature-settings value in insertion order", () => {
    expect(toFontFeatureSettingsCss({ tnum: 1, onum: 1 })).toBe('"tnum" 1, "onum" 1');
  });

  it("ignores non-numeric entries", () => {
    const dirty = { dlig: 1, bogus: "x" } as unknown as Record<string, number>;
    expect(toFontFeatureSettingsCss(dirty)).toBe('"dlig" 1');
  });

  it("omits retired stylistic-set tags", () => {
    expect(toFontFeatureSettingsCss({ dlig: 1, ss03: 1 })).toBe('"dlig" 1');
  });
});

describe("withoutStylisticSetFeatures", () => {
  it("removes stylistic-set tags without mutating the original map", () => {
    const features = { dlig: 1, ss01: 1, ss20: 1 };
    expect(withoutStylisticSetFeatures(features)).toEqual({ dlig: 1 });
    expect(features).toEqual({ dlig: 1, ss01: 1, ss20: 1 });
  });
});

describe("withToggleFeature", () => {
  it("sets a tag to 1 when turning on", () => {
    expect(withToggleFeature(undefined, "dlig", true)).toEqual({ dlig: 1 });
  });

  it("removes the tag when turning off", () => {
    expect(withToggleFeature({ dlig: 1, smcp: 1 }, "dlig", false)).toEqual({ smcp: 1 });
  });

  it("is a no-op turning off a tag that isn't set", () => {
    expect(withToggleFeature({ smcp: 1 }, "dlig", false)).toEqual({ smcp: 1 });
  });

  it("does not mutate the input object", () => {
    const input = { smcp: 1 };
    withToggleFeature(input, "dlig", true);
    expect(input).toEqual({ smcp: 1 });
  });

  it("drops retired stylistic-set tags during an update", () => {
    expect(withToggleFeature({ ss01: 1 }, "dlig", true)).toEqual({ dlig: 1 });
  });
});

describe("mutually-exclusive select groups", () => {
  const numeralForm = OPEN_TYPE_SELECT_GROUPS.find((g) => g.key === "numeralForm")!;
  const numeralSpacing = OPEN_TYPE_SELECT_GROUPS.find((g) => g.key === "numeralSpacing")!;

  it("numeralForm has lining/oldstyle options plus a default (null) option", () => {
    expect(numeralForm.options.map((o) => o.tag)).toEqual([null, "lnum", "onum"]);
  });

  it("numeralSpacing has proportional/tabular options plus a default (null) option", () => {
    expect(numeralSpacing.options.map((o) => o.tag)).toEqual([null, "pnum", "tnum"]);
  });

  it("getGroupSelection returns null when no option in the group is set", () => {
    expect(getGroupSelection(undefined, numeralForm)).toBeNull();
    expect(getGroupSelection({ tnum: 1 }, numeralForm)).toBeNull();
  });

  it("getGroupSelection returns the active tag within the group", () => {
    expect(getGroupSelection({ onum: 1, tnum: 1 }, numeralForm)).toBe("onum");
  });

  it("withGroupSelection sets the chosen tag and clears sibling tags in the group", () => {
    const result = withGroupSelection({ lnum: 1, tnum: 1 }, numeralForm, "onum");
    expect(result).toEqual({ onum: 1, tnum: 1 });
  });

  it("withGroupSelection with null clears the group entirely (back to default)", () => {
    const result = withGroupSelection({ lnum: 1, tnum: 1 }, numeralForm, null);
    expect(result).toEqual({ tnum: 1 });
  });

  it("selecting lining then oldstyle never leaves both set (lining/oldstyle mutual exclusion)", () => {
    let features = withGroupSelection(undefined, numeralForm, "lnum");
    features = withGroupSelection(features, numeralForm, "onum");
    expect(features).toEqual({ onum: 1 });
  });

  it("selecting proportional then tabular never leaves both set (proportional/tabular mutual exclusion)", () => {
    let features = withGroupSelection(undefined, numeralSpacing, "pnum");
    features = withGroupSelection(features, numeralSpacing, "tnum");
    expect(features).toEqual({ tnum: 1 });
  });

  it("numeralForm and numeralSpacing selections don't interfere with each other", () => {
    let features = withGroupSelection(undefined, numeralForm, "onum");
    features = withGroupSelection(features, numeralSpacing, "tnum");
    expect(features).toEqual({ onum: 1, tnum: 1 });
  });

  it("does not mutate the input object", () => {
    const input = { lnum: 1 };
    withGroupSelection(input, numeralForm, "onum");
    expect(input).toEqual({ lnum: 1 });
  });
});

describe("curated toggle feature list", () => {
  it("includes the four requested toggles", () => {
    const tags = OPEN_TYPE_TOGGLE_FEATURES.map((f) => f.tag);
    expect(tags).toEqual(["dlig", "smcp", "frac", "zero"]);
  });
});
