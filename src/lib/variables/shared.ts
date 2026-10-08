import type { Variable, VariableId, VariableType } from "@/types/variable";
import { slugify } from "@/lib/slug";
import { wouldCreateCycle } from "./aliasGraph";
import { modeValuesOf, type VariableIndex } from "./variableIndex";

/** The literal a fresh variable of each type starts with. */
export const TYPE_DEFAULTS: Record<VariableType, string> = {
  color: "#000000",
  number: "0",
  string: "",
};

/** `Dark Mode` -> `dark-mode`; `fallback` when nothing survives. */
export { slugify };

/** A slug of `name` not yet in `taken`; the chosen id is added to `taken`. */
export function uniqueSlug(taken: Set<string>, name: string, fallback = "mode"): string {
  const base = slugify(name, fallback);
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

/** `col_x7k2m9q`, `mode_x7k2m9q`: a short random id with a prefix. */
export function randomId(prefix: string): string {
  return prefix + Math.random().toString(36).substring(2, 9);
}

export type AliasEdgeProblem = "missing" | "type" | "cycle";

/**
 * The one check for "may variable `holderId` (of `holderType`) alias `targetId`":
 * the target must exist, share the holder's type and not close a loop.
 * Returns the first problem, or null when the edge is fine.
 */
export function aliasEdgeProblem(
  index: VariableIndex,
  holderId: VariableId,
  holderType: VariableType,
  targetId: VariableId,
): AliasEdgeProblem | null {
  const target = index.byId.get(targetId);
  if (!target) return "missing";
  if (target.type !== holderType) return "type";
  if (wouldCreateCycle(index, holderId, targetId)) return "cycle";
  return null;
}

/**
 * True if giving `next` its type would contradict an alias: one of its own
 * targets has another type, or a variable that aliases it has another type.
 */
export function typeChangeBreaksAliases(index: VariableIndex, next: Variable): boolean {
  for (const entry of Object.values(modeValuesOf(next))) {
    if (typeof entry === "string") continue;
    if (index.byId.get(entry.alias)?.type !== next.type) return true;
  }
  for (const holder of index.byId.values()) {
    if (holder.id === next.id || holder.type === next.type) continue;
    const aliasesIt = Object.values(modeValuesOf(holder)).some(
      (e) => typeof e !== "string" && e.alias === next.id,
    );
    if (aliasesIt) return true;
  }
  return false;
}
