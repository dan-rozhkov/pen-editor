import { beforeEach, describe, expect, it } from "vitest";
import { buildVariableStyleBlock, collectVariableValues } from "../variableCssUtils";
import { useVariableStore } from "@/store/variableStore";
import type { Variable } from "@/types/variable";

// EmbedLayer.tsx's mount effect (buildVariableStyleBlock, the one-time
// <style> block) and its live-update effect (collectVariableValues, feeding
// applyEditorVariableProperties in embedHtmlUtils.ts) must resolve the same
// variable to the same value — these tests cover the shared resolution the
// two now go through.

function seedVariable(overrides: Partial<Variable> = {}): Variable {
  const variable: Variable = {
    id: "v1",
    name: "--brand",
    type: "color",
    value: "#00ff00",
    themeValues: { light: "#00ff00", dark: "#003300" },
    ...overrides,
  };
  useVariableStore.setState({ variables: [variable] });
  return variable;
}

describe("collectVariableValues", () => {
  beforeEach(() => {
    useVariableStore.setState({ variables: [] });
  });

  it("resolves every variable to its light value by default", () => {
    seedVariable();
    const values = collectVariableValues();
    expect(values.get("--brand")).toBe("#00ff00");
  });

  it("resolves the requested theme", () => {
    seedVariable();
    const values = collectVariableValues(undefined, "dark");
    expect(values.get("--brand")).toBe("#003300");
  });

  it("filters to only the given variable ids", () => {
    useVariableStore.setState({
      variables: [
        { id: "v1", name: "--a", type: "color", value: "#111111" },
        { id: "v2", name: "--b", type: "color", value: "#222222" },
      ],
    });
    const values = collectVariableValues(new Set(["v2"]));
    expect(values.has("--a")).toBe(false);
    expect(values.get("--b")).toBe("#222222");
  });

  it("returns an empty map when there are no variables", () => {
    expect(collectVariableValues().size).toBe(0);
  });

  it("keys by the canonical CSS name, not the raw free-form label", () => {
    seedVariable({ name: "Color 1", value: "#abcdef", themeValues: { light: "#abcdef", dark: "#abcdef" } });
    const values = collectVariableValues();
    expect(values.has("Color 1")).toBe(false);
    expect(values.get("--color-1")).toBe("#abcdef");
  });
});

describe("buildVariableStyleBlock", () => {
  beforeEach(() => {
    useVariableStore.setState({ variables: [] });
  });

  it("returns an empty string when there are no variables", () => {
    expect(buildVariableStyleBlock()).toBe("");
  });

  it("builds a :root style block from the current variables", () => {
    seedVariable();
    expect(buildVariableStyleBlock()).toBe("<style>:root { --brand: #00ff00; }</style>");
  });

  // Variables-panel-created variables ("Color 1") are NOT --prefixed CSS
  // identifiers — collectVariableValues/buildVariableStyleBlock must key on
  // the canonical CSS name (getVariableCssName) or the declaration is either
  // a silent setProperty no-op or invalid CSS. See getVariableCssName's doc
  // comment in src/types/variable.ts for the full rationale.
  it("keys the style block on the canonical CSS name for a free-form variable name", () => {
    seedVariable({ name: "Color 1", value: "#112233", themeValues: { light: "#112233", dark: "#112233" } });
    expect(buildVariableStyleBlock()).toBe("<style>:root { --color-1: #112233; }</style>");
  });
});
