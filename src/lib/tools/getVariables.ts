import { useVariableStore } from "@/store/variableStore";
import { useThemeStore } from "@/store/themeStore";
import {
  THEME_COLLECTION_ID,
  getVariableCssName,
  type Variable,
  type VariableCollection,
} from "@/types/variable";
import {
  buildVariableIndex,
  completeModeContext,
  collectionIdOf,
  modeValuesOf,
  resolveVariable,
  type VariableIndex,
} from "@/lib/variables";
import type { ToolHandler } from "../toolRegistry";
import {
  findCollection,
  findMode,
  formatVariableRef,
  resolveVariableRef,
} from "./variableToolUtils";

/** `$--name` for an alias (`$Collection/--name` when the name is ambiguous). */
function aliasText(index: VariableIndex, variables: Variable[], collections: VariableCollection[], targetId: string): string {
  const target = index.byId.get(targetId);
  if (!target) return `$${targetId}`;
  return formatVariableRef(variables, collections, target);
}

function asStringList(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : [];
}

export const getVariables: ToolHandler = async (args) => {
  const { variables, collections } = useVariableStore.getState();
  const index = buildVariableIndex(variables, collections);
  const allCollections: VariableCollection[] = [...index.collections.values()];

  // The mode each collection shows right now (document level).
  const modeContext = completeModeContext(allCollections, useThemeStore.getState().modeContext);

  const hints: string[] = [];
  let selected: Variable[] = variables;

  if (typeof args.collection === "string" && args.collection.trim() !== "") {
    const collection = findCollection(allCollections, args.collection);
    if (!collection) {
      selected = [];
      hints.push(
        `No collection matches "${args.collection}". Collections: ${allCollections
          .map((c) => c.name)
          .join(", ")}.`,
      );
    } else {
      selected = selected.filter((v) => collectionIdOf(v) === collection.id);
    }
  }

  const names = asStringList(args.names);
  if (names.length > 0) {
    const wanted = new Set<string>();
    const missing: string[] = [];
    for (const name of names) {
      const hits = resolveVariableRef(selected, allCollections, name);
      if (hits.length === 0) missing.push(name);
      for (const hit of hits) wanted.add(hit.id);
    }
    selected = selected.filter((v) => wanted.has(v.id));
    if (missing.length > 0) {
      hints.push(`No variable matches: ${missing.join(", ")}. Call get_variables with no arguments to list all names.`);
    }
  }

  // `mode`: a string is a mode of the Theme collection; an object maps
  // collection names to mode names. Collections not named keep all modes.
  const modeFilter = new Map<string, string>();
  if (typeof args.mode === "string" && args.mode.trim() !== "") {
    const theme = index.collections.get(THEME_COLLECTION_ID);
    const mode = theme ? findMode(theme, args.mode) : undefined;
    if (mode) modeFilter.set(THEME_COLLECTION_ID, mode.id);
    else hints.push(`No Theme mode matches "${args.mode}".`);
  } else if (args.mode && typeof args.mode === "object" && !Array.isArray(args.mode)) {
    for (const [collectionRef, modeRef] of Object.entries(args.mode as Record<string, unknown>)) {
      const collection = findCollection(allCollections, collectionRef);
      const mode = collection && typeof modeRef === "string" ? findMode(collection, modeRef) : undefined;
      if (collection && mode) modeFilter.set(collection.id, mode.id);
      else hints.push(`No mode matches ${collectionRef}: ${String(modeRef)}.`);
    }
  }

  const out = selected.map((v) => {
    const cid = collectionIdOf(v);
    const collection = index.collections.get(cid);
    const raw = modeValuesOf(v);
    const only = modeFilter.get(cid);
    const values: Record<string, { raw: string; resolved: string }> = {};
    for (const mode of collection?.modes ?? []) {
      if (only !== undefined && mode.id !== only) continue;
      const entry = raw[mode.id];
      if (entry === undefined) continue;
      const resolved = resolveVariable(index, v.id, { [cid]: mode.id });
      values[mode.name] = {
        raw: typeof entry === "string" ? entry : aliasText(index, variables, allCollections, entry.alias),
        resolved: resolved.ok ? resolved.value : v.value,
      };
    }
    const deprecated = v.deprecated
      ? {
          ...v.deprecated,
          ...(v.deprecated.replacedBy
            ? { replacedBy: aliasText(index, variables, allCollections, v.deprecated.replacedBy) }
            : {}),
        }
      : undefined;
    return {
      id: v.id,
      name: v.name,
      type: v.type,
      value: v.value,
      themeValues: v.themeValues,
      // The canonical CSS custom-property name, the same one the editor
      // injects into every embed and the one `canvasContext.variables`
      // carries. `name` is a free-form label ("Color 1" straight out of the
      // Variables panel) and is NOT usable in `var(...)`; the system prompt
      // tells the model to reference `cssName` inside embed HTML, so this
      // tool must report it too or the two channels disagree.
      cssName: getVariableCssName(v),
      collection: collection?.name ?? cid,
      values,
      description: v.description,
      scopes: v.scopes,
      deprecated,
    };
  });

  if (out.length === 0 && hints.length === 0) {
    hints.push(
      variables.length === 0
        ? "The document has no variables yet. Create them with set_variables."
        : "No variable matches the filter.",
    );
  }

  return JSON.stringify({
    collections: allCollections.map((c) => ({
      id: c.id,
      name: c.name,
      modes: c.modes,
      defaultModeId: c.defaultModeId,
    })),
    modeContext,
    variables: out,
    ...(hints.length > 0 ? { hint: hints.join(" ") } : {}),
  });
};
