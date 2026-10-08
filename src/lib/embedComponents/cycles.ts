import { parseMaster } from "./master";
import type { ComponentRegistry } from "./types";

/**
 * Would defining `key` with the given `nested` component keys create a
 * dependency cycle (key -> ... -> key)? Returns the cycle as a key path
 * (`["a", "b", "a"]`) or null. The registry's existing entry for `key`, if
 * any, is ignored: the candidate replaces it.
 */
export function findDependencyCycle(
  registry: ComponentRegistry,
  key: string,
  nested: string[],
): string[] | null {
  const visiting: string[] = [key];
  const done = new Set<string>();

  const visit = (deps: string[]): string[] | null => {
    for (const dep of deps) {
      if (dep === key) return [...visiting, key];
      if (done.has(dep) || visiting.includes(dep)) continue;
      const master = registry.get(dep);
      const parsed = master ? parseMaster(master) : null;
      if (!parsed) continue;
      visiting.push(dep);
      const cycle = visit(parsed.nested);
      visiting.pop();
      if (cycle) return cycle;
      done.add(dep);
    }
    return null;
  };
  return visit(nested);
}
