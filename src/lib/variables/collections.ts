import {
  THEME_COLLECTION_ID,
  generateVariableId,
  type Variable,
  type VariableCollection,
  type VariableType,
} from "@/types/variable";

export { THEME_COLLECTION_ID };

/** The built-in collection: modes `light` and `dark`, `light` is the default. */
export function makeThemeCollection(): VariableCollection {
  return {
    id: THEME_COLLECTION_ID,
    name: "Theme",
    modes: [
      { id: "light", name: "Light" },
      { id: "dark", name: "Dark" },
    ],
    defaultModeId: "light",
  };
}

/** A Theme-collection variable with the legacy mirrors already filled in. */
export function makeThemeVariable(
  name: string,
  light: string,
  dark: string,
  type: VariableType = "color",
): Variable {
  return {
    id: generateVariableId(),
    name,
    type,
    collectionId: THEME_COLLECTION_ID,
    valuesByMode: { light, dark },
    value: light,
    themeValues: { light, dark },
  };
}

/** Return `collections` with the Theme collection first if it was missing. */
export function ensureThemeCollection(collections: VariableCollection[]): VariableCollection[] {
  return collections.some((c) => c.id === THEME_COLLECTION_ID)
    ? collections
    : [makeThemeCollection(), ...collections];
}
