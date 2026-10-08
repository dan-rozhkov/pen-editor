import type { Variable, VariableId } from "@/types/variable";
import { modeValuesOf, type VariableIndex } from "./variableIndex";

/** Every variable id `variable` points at, over all its modes. */
function aliasTargets(variable: Variable): VariableId[] {
  const out = new Set<VariableId>();
  for (const entry of Object.values(modeValuesOf(variable))) {
    if (typeof entry !== "string") out.add(entry.alias);
  }
  return [...out];
}

/** True if making `variableId` point at `targetId` would close a loop (including a self-loop). */
export function wouldCreateCycle(
  index: VariableIndex,
  variableId: VariableId,
  targetId: VariableId,
): boolean {
  if (variableId === targetId) return true;
  const seen = new Set<VariableId>();
  const stack = [targetId];
  while (stack.length > 0) {
    const id = stack.pop() as VariableId;
    if (id === variableId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const v = index.byId.get(id);
    if (v) stack.push(...aliasTargets(v));
  }
  return false;
}

/** Strongly connected groups of aliases (size > 1, or a self-loop), via Tarjan. */
export function findCycles(variables: Variable[]): VariableId[][] {
  const byId = new Map(variables.map((v) => [v.id, v]));
  const order = new Map<VariableId, number>();
  const low = new Map<VariableId, number>();
  const onStack = new Set<VariableId>();
  const stack: VariableId[] = [];
  const cycles: VariableId[][] = [];
  let counter = 0;

  const visit = (id: VariableId): void => {
    order.set(id, counter);
    low.set(id, counter);
    counter++;
    stack.push(id);
    onStack.add(id);
    const variable = byId.get(id);
    const targets = variable ? aliasTargets(variable) : [];
    for (const t of targets) {
      if (!byId.has(t)) continue;
      if (!order.has(t)) {
        visit(t);
        low.set(id, Math.min(low.get(id) as number, low.get(t) as number));
      } else if (onStack.has(t)) {
        low.set(id, Math.min(low.get(id) as number, order.get(t) as number));
      }
    }
    if (low.get(id) === order.get(id)) {
      const group: VariableId[] = [];
      let top: VariableId;
      do {
        top = stack.pop() as VariableId;
        onStack.delete(top);
        group.push(top);
      } while (top !== id);
      const selfLoop = group.length === 1 && targets.includes(id);
      if (group.length > 1 || selfLoop) cycles.push(group);
    }
  };

  for (const v of variables) if (!order.has(v.id)) visit(v.id);
  return cycles;
}

/** Every variable that (transitively) aliases `id`. */
export function aliasDependents(index: VariableIndex, id: VariableId): Set<VariableId> {
  const direct = new Map<VariableId, VariableId[]>();
  for (const v of index.byId.values()) {
    for (const t of aliasTargets(v)) {
      const list = direct.get(t);
      if (list) list.push(v.id);
      else direct.set(t, [v.id]);
    }
  }
  const out = new Set<VariableId>();
  const stack = [id];
  while (stack.length > 0) {
    for (const dep of direct.get(stack.pop() as VariableId) ?? []) {
      if (out.has(dep) || dep === id) continue;
      out.add(dep);
      stack.push(dep);
    }
  }
  return out;
}
