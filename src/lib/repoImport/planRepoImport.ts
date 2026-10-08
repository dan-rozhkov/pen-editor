import { useHistoryStore } from "@/store/historyStore";
import { createSnapshot, useSceneStore } from "@/store/sceneStore";
import { useVariableStore } from "@/store/variableStore";
import { THEME_COLLECTION_ID, getVariableCssName, type Variable, type VariableCollection } from "@/types/variable";
import { collectionIdOf } from "@/lib/variables";
import { isLibraryOwned, libraryOwnedMessage } from "@/lib/designSystem/ownership";
import { parseSetVariablesArgs } from "@/lib/tools/setVariables";
import { planVariableChanges, type VariableEntry } from "@/lib/tools/variablesPlan";
import { findCollection } from "@/lib/tools/variableToolUtils";
import {
  PRIMITIVES_COLLECTION,
  THEME_COLLECTION_NAME,
  convertDesignTokens,
  type RepoDesignTokens,
  type TokenConversion,
} from "./designTokensToVariables";

export interface SkippedImport {
  name: string;
  reason: string;
}

export interface RepoImportPreview {
  conversion: TokenConversion;
  /** The tokens the plan was made from, so a caller can re-plan against newer state. */
  tokens: RepoDesignTokens;
  /** Existing local variables an apply would overwrite (Primitives refresh). */
  overwrites: string[];
  /** Entries dropped: library-owned items, name clashes, kept Theme variables. */
  skipped: SkippedImport[];
  createCount: number;
  updateCount: number;
  warnings: string[];
}

export type RepoImportPlan =
  | { ok: false; error: string }
  | { ok: true; preview: RepoImportPreview; apply: () => void };

const cssOf = (name: string): string => getVariableCssName({ id: "", name });

/**
 * Plan a repo import against the current variables without applying it. Uses the same
 * `planVariableChanges` as `set_variables`; entries that would touch library-owned data,
 * clash with a name elsewhere, or replace an existing Theme variable are dropped and reported
 * instead of failing the whole import.
 */
export function planRepoImport(
  tokens: RepoDesignTokens,
  variables: Variable[],
  collections: VariableCollection[],
): RepoImportPlan {
  const existingPrimitives = findCollection(collections, PRIMITIVES_COLLECTION);
  const conversion = convertDesignTokens(tokens, {
    existingPrimitivesModes: existingPrimitives?.modes.map((m) => m.name),
  });
  const parsed = parseSetVariablesArgs({ ...conversion.args });
  if (parsed.errors.length > 0) return { ok: false, error: parsed.errors.join(" ") };

  const skipped: SkippedImport[] = [];
  const overwrites: string[] = [];
  let collectionSpecs = parsed.collectionSpecs;
  const dropped = new Set<VariableEntry>();
  const skip = (e: VariableEntry, reason: string): void => {
    dropped.add(e);
    skipped.push({ name: e.name ?? "Untitled", reason });
  };

  const themeId = THEME_COLLECTION_ID;
  const nameOf = (id: string): string => collections.find((c) => c.id === id)?.name ?? id;

  if (existingPrimitives && isLibraryOwned(existingPrimitives)) {
    collectionSpecs = undefined;
  }
  for (const e of parsed.entries) {
    const css = cssOf(e.name ?? "");
    const target = findCollection(collections, e.collection ?? "");
    if (target && isLibraryOwned(target)) {
      skip(e, libraryOwnedMessage("collection", target.name, target.libraryId as string));
      continue;
    }
    const isTheme = (e.collection ?? "").toLowerCase() === THEME_COLLECTION_NAME.toLowerCase();
    const targetId = target?.id ?? (isTheme ? themeId : undefined);
    const same = variables.filter((v) => getVariableCssName(v) === css);
    const lib = same.find((v) => isLibraryOwned(v));
    if (lib) {
      skip(e, `${css} is already used by the library-owned token "${lib.name}".`);
      continue;
    }
    const elsewhere = same.find((v) => collectionIdOf(v) !== targetId);
    if (elsewhere) {
      skip(e, `${css} already exists in the "${nameOf(collectionIdOf(elsewhere))}" collection.`);
      continue;
    }
    if (same.length > 0) {
      if (isTheme) skip(e, `${css} already exists in Theme; kept as it is.`);
      else overwrites.push(e.name ?? css);
    }
  }
  // An alias whose primitive was dropped has nothing to point at.
  for (let changed = true; changed; ) {
    changed = false;
    const live = new Set(parsed.entries.filter((e) => !dropped.has(e)).map((e) => cssOf(e.name ?? "")));
    for (const e of parsed.entries) {
      if (dropped.has(e)) continue;
      const refs = Object.values(e.modeValues ?? {}).filter((v) => v.startsWith("$"));
      if (refs.some((r) => !live.has(cssOf(r.slice(1))))) {
        skip(e, "its Primitives variable was not imported.");
        changed = true;
      }
    }
  }

  const entries = parsed.entries.filter((e) => !dropped.has(e));
  if (entries.length === 0) {
    return { ok: false, error: skipped.length > 0 ? "Nothing to import: every token clashes with existing data." : "The repo has no importable tokens." };
  }
  const plan = planVariableChanges({
    entries,
    collectionSpecs,
    defaultCollection: parsed.defaultCollection,
    replace: false,
    variables,
    collections,
  });
  if ("error" in plan) return { ok: false, error: plan.error };

  return {
    ok: true,
    preview: {
      conversion,
      tokens,
      overwrites,
      skipped,
      createCount: plan.created.length,
      updateCount: plan.updated.length,
      warnings: plan.warnings,
    },
    // One undo step: a single history snapshot, then one replaceAll.
    apply: () => {
      useHistoryStore.getState().saveHistory(createSnapshot(useSceneStore.getState()));
      useVariableStore.getState().replaceAll(plan.variables, plan.collections);
    },
  };
}
