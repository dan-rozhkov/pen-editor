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
});
