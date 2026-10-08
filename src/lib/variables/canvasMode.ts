import { THEME_COLLECTION_ID, type VariableCollection } from "@/types/variable";
import { useThemeStore } from "@/store/themeStore";
import { useVariableStore } from "@/store/variableStore";

/**
 * Collections that offer a real choice (two or more modes). The canvas mode
 * switcher lists these; a single-mode collection has nothing to switch.
 */
export function getSwitchableCollections(collections: VariableCollection[]): VariableCollection[] {
  return collections.filter((c) => c.modes.length > 1);
}

/**
 * Moves the Theme collection to its next mode (light to dark and back).
 * Writes the document-level mode context only. It is not an undo step, same
 * as every other mode switch. Returns false when there is no Theme collection
 * with a choice.
 */
export function toggleCanvasMode(): boolean {
  const theme = useVariableStore.getState().collections.find((c) => c.id === THEME_COLLECTION_ID);
  if (!theme || theme.modes.length < 2) return false;
  const { modeContext, setCollectionMode } = useThemeStore.getState();
  const current = modeContext[THEME_COLLECTION_ID] ?? theme.defaultModeId;
  const index = theme.modes.findIndex((m) => m.id === current);
  setCollectionMode(THEME_COLLECTION_ID, theme.modes[(index + 1) % theme.modes.length].id);
  return true;
}
