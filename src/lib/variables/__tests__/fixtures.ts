import type { Variable, VariableCollection, VariableModeValue } from "@/types/variable";
import { makeThemeCollection } from "../collections";

/** A v2 variable in `collectionId` built from a plain `modeId -> value` map. */
export function v2Var(
  id: string,
  collectionId: string,
  valuesByMode: Record<string, VariableModeValue>,
  type: Variable["type"] = "color",
): Variable {
  return { id, name: id, type, collectionId, valuesByMode, value: "" };
}

export const brandCollection: VariableCollection = {
  id: "brand",
  name: "Brand",
  modes: [
    { id: "acme", name: "Acme" },
    { id: "globex", name: "Globex" },
  ],
  defaultModeId: "acme",
};

export const collections: VariableCollection[] = [makeThemeCollection(), brandCollection];
