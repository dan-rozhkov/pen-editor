import type { DesignSystemScope } from "@/types/designSystemScope";
import type { VariableScope } from "@/types/variable";
import { VARIABLE_SCOPES } from "@/lib/tools/variableToolUtils";

const STATUSES = ["draft", "stable", "deprecated"] as const;

function strings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((s): s is string => typeof s === "string" && s.trim() !== "");
  return out.length > 0 ? out : undefined;
}

function one(raw: unknown): DesignSystemScope | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id === "" || typeof r.name !== "string" || r.name.trim() === "") return null;

  const collections = strings(r.collections);
  const names = strings(r.names);
  const tokenScopes = strings(r.tokenScopes)?.filter((s): s is VariableScope =>
    (VARIABLE_SCOPES as readonly string[]).includes(s),
  );

  let modes: DesignSystemScope["modes"];
  if (r.modes && typeof r.modes === "object" && !Array.isArray(r.modes)) {
    const entries = Object.entries(r.modes as Record<string, unknown>)
      .map(([cid, ids]) => [cid, strings(ids)] as const)
      .filter((e): e is readonly [string, string[]] => e[1] !== undefined);
    if (entries.length > 0) modes = Object.fromEntries(entries);
  }

  let components: DesignSystemScope["components"];
  if (r.components && typeof r.components === "object") {
    const c = r.components as Record<string, unknown>;
    const keys = strings(c.keys);
    const status = strings(c.status)?.filter((s): s is (typeof STATUSES)[number] =>
      (STATUSES as readonly string[]).includes(s),
    );
    if (keys || (status && status.length > 0)) {
      components = { ...(keys ? { keys } : {}), ...(status && status.length > 0 ? { status } : {}) };
    }
  }

  return {
    id: r.id,
    name: r.name,
    ...(typeof r.description === "string" && r.description !== "" ? { description: r.description } : {}),
    ...(collections ? { collections } : {}),
    ...(modes ? { modes } : {}),
    ...(components ? { components } : {}),
    ...(tokenScopes && tokenScopes.length > 0 ? { tokenScopes } : {}),
    ...(names ? { names } : {}),
  };
}

/**
 * Read the `designSystemScopes` field of a `.pen` file. A file is user input
 * (older builds, hand edits): anything malformed is dropped, never thrown on,
 * and a repeated id keeps its first entry.
 */
export function sanitizeDesignSystemScopes(raw: unknown): DesignSystemScope[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: DesignSystemScope[] = [];
  for (const item of raw) {
    const scope = one(item);
    if (!scope || seen.has(scope.id)) continue;
    seen.add(scope.id);
    out.push(scope);
  }
  return out;
}
