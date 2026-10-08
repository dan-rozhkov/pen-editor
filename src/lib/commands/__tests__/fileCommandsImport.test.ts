import { beforeEach, describe, expect, it } from "vitest";
import { applyImport } from "../fileCommands";
import { useVariableStore } from "@/store/variableStore";
import { resetStores } from "@/test/fixtures";
import type { Variable, VariableCollection } from "@/types/variable";

const v = (id: string, name: string, collectionId: string, extra: Partial<Variable> = {}): Variable => ({
  id,
  name,
  type: "color",
  collectionId,
  valuesByMode: collectionId === "theme" ? { light: "#111111", dark: "#111111" } : { a: "#111111" },
  value: "#111111",
  ...extra,
});
const libCollection: VariableCollection = {
  id: "col_lib",
  name: "Lib",
  modes: [{ id: "a", name: "A" }],
  defaultModeId: "a",
  libraryId: "lib_x",
};

describe("applyImport with a linked library", () => {
  beforeEach(() => {
    resetStores();
    const theme = useVariableStore.getState().collections[0];
    useVariableStore.getState().replaceAll([v("lib_brand", "Brand", "theme", { libraryId: "lib_x" })], [theme, libCollection]);
  });

  it("skips tokens that clash with a library CSS name or target a library collection, and reports them", () => {
    const { skipped } = applyImport({
      variables: [v("n1", "brand", "theme"), v("n2", "Into Lib", "col_lib"), v("n3", "Fresh", "theme")],
      collections: [],
      fillStyles: [],
      effectStyles: [],
      textStyles: [],
    });
    expect(skipped.sort()).toEqual(["Into Lib", "brand"]);
    const ids = useVariableStore.getState().variables.map((x) => x.id).sort();
    expect(ids).toEqual(["lib_brand", "n3"]);
  });

  it("skips, transitively, imported variables that alias a skipped one, and reports them", () => {
    const alias = (id: string, name: string, target: string) =>
      v(id, name, "theme", { valuesByMode: { light: { alias: target }, dark: { alias: target } } });
    const { skipped } = applyImport({
      variables: [v("n1", "brand", "theme"), alias("n4", "Cta", "n1"), alias("n5", "Cta Hover", "n4"), alias("n6", "Ok", "lib_brand")],
      collections: [],
      fillStyles: [],
      effectStyles: [],
      textStyles: [],
    });
    expect(skipped.sort()).toEqual(["Cta", "Cta Hover", "brand"]);
    expect(useVariableStore.getState().variables.map((x) => x.id).sort()).toEqual(["lib_brand", "n6"]);
  });
});
