import { useVariableStore } from "@/store/variableStore";
import { useThemeStore } from "@/store/themeStore";
import { getVariableCssName, type Variable, type VariableCollection } from "@/types/variable";
import {
  buildVariableIndex,
  completeModeContext,
  collectionIdOf,
  type VariableIndex,
} from "@/lib/variables";
import type { ToolHandler } from "../toolRegistry";
import {
  findCollection,
  formatVariableRef,
  resolveVariableRef,
} from "./variableToolUtils";
import { describeModeValues, readModeArg } from "./variableValues";

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
  // collection names to mode names. Collections not named keep all modes. The
  // listed mode resolves against the document context for the other collections.
  const modeArg = readModeArg(args.mode, allCollections);
  hints.push(...modeArg.hints);
  const resolveCtx = { ...modeContext, ...modeArg.picks };

  const out = selected.map((v) => {
    const cid = collectionIdOf(v);
    const collection = index.collections.get(cid);
    const values = describeModeValues(v, collection, resolveCtx, modeArg.picks[cid], index, variables, allCollections);
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
    modeContext: resolveCtx,
    variables: out,
    ...(hints.length > 0 ? { hint: hints.join(" ") } : {}),
  });
};
