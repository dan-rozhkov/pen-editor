import { describe, it, expect, beforeEach } from "vitest";
import { getVariables } from "@/lib/tools/getVariables";
import { setVariables } from "@/lib/tools/setVariables";
import { useVariableStore } from "@/store/variableStore";
import { resetStores, seedVariables } from "@/test/fixtures";

beforeEach(() => {
  resetStores();
});

describe("get_variables", () => {
  it("returns an empty list when no variables exist", async () => {
    expect(JSON.parse(await getVariables({}))).toEqual({ variables: [] });
  });

  it("serializes variables with theme values", async () => {
    seedVariables();
    const result = JSON.parse(await getVariables({}));
    expect(result.variables).toEqual([
      {
        id: "var-primary",
        name: "--primary",
        type: "color",
        value: "#3366ff",
        themeValues: { light: "#3366ff", dark: "#99bbff" },
      },
      { id: "var-radius", name: "--radius-m", type: "number", value: "8" },
    ]);
  });
});

describe("set_variables", () => {
  it("returns an error when no variables are provided", async () => {
    const result = JSON.parse(await setVariables({}));
    expect(result.error).toBe("No variables provided");
  });

  it("returns an error when input contains no valid definitions", async () => {
    const result = JSON.parse(await setVariables({ variables: {} }));
    expect(result.error).toBe("No valid variables found in input");
  });

  it("accepts an array of variable definitions", async () => {
    const result = JSON.parse(
      await setVariables({
        variables: [
          { name: "--accent", type: "color", value: "#ff00ff" },
        ] as unknown as Record<string, unknown>,
      })
    );
    expect(result).toEqual({ success: true, variableCount: 1 });

    const { variables } = useVariableStore.getState();
    expect(variables[0]).toMatchObject({
      name: "--accent",
      type: "color",
      value: "#ff00ff",
    });
    expect(variables[0].id).toBeTruthy();
  });

  it("accepts nested design-token objects with $type/$value", async () => {
    const result = JSON.parse(
      await setVariables({
        variables: {
          colors: {
            "background-primary": { $type: "color", $value: "#ffffff" },
          },
          radius: {
            "radius-m": { $type: "number", $value: "8" },
          },
        },
      })
    );
    expect(result).toEqual({ success: true, variableCount: 2 });

    const names = useVariableStore
      .getState()
      .variables.map((v) => v.name)
      .sort();
    expect(names).toEqual(["background-primary", "radius-m"]);
  });

  it("merges by name, updating existing variables and keeping their ids", async () => {
    seedVariables();
    const result = JSON.parse(
      await setVariables({
        variables: [
          { name: "--primary", type: "color", value: "#111111" },
          { name: "--brand-new", type: "color", value: "#222222" },
        ] as unknown as Record<string, unknown>,
      })
    );
    expect(result).toEqual({ success: true, variableCount: 3 });

    const { variables } = useVariableStore.getState();
    const primary = variables.find((v) => v.name === "--primary");
    expect(primary?.id).toBe("var-primary"); // id preserved on merge
    expect(primary?.value).toBe("#111111");
    expect(variables.some((v) => v.name === "--brand-new")).toBe(true);
    expect(variables.some((v) => v.name === "--radius-m")).toBe(true);
  });

  it("replaces the entire set when replace=true", async () => {
    seedVariables();
    const result = JSON.parse(
      await setVariables({
        variables: [
          { name: "--only", type: "color", value: "#333333" },
        ] as unknown as Record<string, unknown>,
        replace: true,
      })
    );
    expect(result).toEqual({ success: true, variableCount: 1 });
    expect(useVariableStore.getState().variables.map((v) => v.name)).toEqual([
      "--only",
    ]);
  });
});
