import { parseMaster } from "./master";
import type { ComponentRegistry, ParsedMaster } from "./types";

const RAW_TAG = /<c-([a-z][a-z0-9-]*)(?=[\s/>])/g;

/**
 * Keys a master depends on: nested regions plus raw `<c-KEY>` tags (registered
 * or not yet: defining that key later expands the tag into a nested region).
 */
export function dependencyKeys(parsed: Pick<ParsedMaster, "nested" | "html">): string[] {
  const keys = new Set(parsed.nested);
  for (const m of parsed.html.matchAll(RAW_TAG)) if (m[1] !== "slot") keys.add(m[1]);
  return [...keys];
}

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
      const cycle = visit(dependencyKeys(parsed));
      visiting.pop();
      if (cycle) return cycle;
      done.add(dep);
    }
    return null;
  };
  return visit(nested);
}
