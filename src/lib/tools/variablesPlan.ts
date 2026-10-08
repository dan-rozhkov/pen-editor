import {
  THEME_COLLECTION_ID,
  generateVariableId,
  getVariableCssName,
  type ModeId,
  type Variable,
  type VariableCollection,
  type VariableId,
  type VariableModeValue,
  type VariableScope,
  type VariableType,
} from "@/types/variable";
import {
  TYPE_DEFAULTS,
  collectionIdOf,
  ensureThemeCollection,
  findCycles,
  modeValuesOf,
  randomId,
  uniqueSlug,
} from "@/lib/variables";
import { isLibraryOwned, libraryOwnedMessage, variableReplacementError } from "@/lib/designSystem/ownership";
import {
  findCollection,
  findMode,
  resolveVariableRef,
  stripVariableRef,
} from "./variableToolUtils";

/** One variable as the agent wrote it, after shape checks. Absent field = leave as is. */
export interface VariableEntry {
  id?: string;
  name?: string;
  type?: VariableType;
  value?: string;
  /** Mode name or id -> raw value (a string starting with `$` is an alias). */
  modeValues?: Record<string, string>;
  collection?: string;
  description?: string;
  scopes?: VariableScope[];
  deprecated?: { since?: string; replacedBy?: string; note?: string };
}

export interface CollectionSpec {
  modes: string[];
  defaultMode?: string;
}

export interface PlanInput {
  entries: VariableEntry[];
  collectionSpecs?: Record<string, CollectionSpec>;
  defaultCollection?: string;
  replace: boolean;
  variables: Variable[];
  collections: VariableCollection[];
}

export type Plan =
  | { error: string }
  | {
      variables: Variable[];
      collections: VariableCollection[];
      created: string[];
      updated: string[];
      warnings: string[];
    };

function sameName(a: string, b: string): boolean {
  return stripVariableRef(a) === stripVariableRef(b);
}

function modeNames(collection: VariableCollection): string {
  return collection.modes.map((m) => m.name).join(", ");
}

/**
 * Compute the result of a `set_variables` call without touching the store.
 * Any problem returns `{ error }`, so the caller applies nothing.
 */
export function planVariableChanges(input: PlanInput): Plan {
  const errors: string[] = [];
  const warnings: string[] = [];

  let collections = ensureThemeCollection(input.collections).map((c) => ({
    ...c,
    modes: [...c.modes],
  }));
  let variables: Variable[] = input.variables;

  if (input.replace) {
    // Library-owned data is not the agent's to replace: it stays.
    variables = variables.filter((v) => isLibraryOwned(v));
    if (input.collectionSpecs) {
      collections = collections.filter((c) => c.id === THEME_COLLECTION_ID || isLibraryOwned(c));
    }
  }
  let next: Variable[] = variables.map((v) => ({ ...v }));

  // ── Collections ────────────────────────────────────────────────────
  for (const [name, spec] of Object.entries(input.collectionSpecs ?? {})) {
    const lowerNames = spec.modes.map((m) => m.trim().toLowerCase());
    if (new Set(lowerNames).size !== lowerNames.length) {
      errors.push(`collections.${name}: duplicate mode names.`);
      continue;
    }
    const existing = findCollection(collections, name);
    if (existing && existing.id === THEME_COLLECTION_ID) {
      const unknown = spec.modes.filter((m) => !findMode(existing, m));
      if (unknown.length > 0) {
        errors.push(`collections.${name}: the Theme collection has fixed modes (${modeNames(existing)}); cannot add ${unknown.join(", ")}.`);
      }
      if (spec.defaultMode && findMode(existing, spec.defaultMode)?.id !== existing.defaultModeId) {
        errors.push(`collections.${name}: the default mode of the Theme collection is fixed.`);
      }
      continue;
    }
    if (existing && isLibraryOwned(existing)) {
      errors.push(`collections.${name}: ${libraryOwnedMessage("collection", existing.name, existing.libraryId as string)}`);
      continue;
    }
    if (existing) {
      const taken = new Set(existing.modes.map((m) => m.id));
      for (const modeName of spec.modes) {
        if (findMode(existing, modeName)) continue;
        const mode = { id: uniqueSlug(taken, modeName), name: modeName.trim() };
        existing.modes.push(mode);
        // A new mode starts as a copy of the default mode.
        next = next.map((v) => {
          if (collectionIdOf(v) !== existing.id) return v;
          const modes = modeValuesOf(v);
          const seed = modes[existing.defaultModeId];
          return seed === undefined ? v : { ...v, valuesByMode: { ...modes, [mode.id]: seed } };
        });
      }
      if (spec.defaultMode) {
        const mode = findMode(existing, spec.defaultMode);
        if (!mode) errors.push(`collections.${name}: defaultMode "${spec.defaultMode}" is not a mode (${modeNames(existing)}).`);
        else existing.defaultModeId = mode.id;
      }
      continue;
    }
    const taken = new Set<string>();
    const modes = spec.modes.map((m) => ({ id: uniqueSlug(taken, m), name: m.trim() }));
    const created: VariableCollection = {
      id: randomId("col_"),
      name: name.trim(),
      modes,
      defaultModeId: modes[0].id,
    };
    if (spec.defaultMode) {
      const mode = findMode(created, spec.defaultMode);
      if (!mode) errors.push(`collections.${name}: defaultMode "${spec.defaultMode}" is not a mode (${modeNames(created)}).`);
      else created.defaultModeId = mode.id;
    }
    collections.push(created);
  }

  const defaultCollectionName = input.defaultCollection?.trim();
  // The call-level `collection` is created on demand; a per-variable one must exist.
  const resolveCollection = (ref: string, create: boolean): VariableCollection | undefined => {
    const found = findCollection(collections, ref);
    if (found || !create) return found;
    const made: VariableCollection = {
      id: randomId("col_"),
      name: ref.trim(),
      modes: [{ id: "default", name: "Default" }],
      defaultModeId: "default",
    };
    collections.push(made);
    return made;
  };
  const defaultTarget = defaultCollectionName ? resolveCollection(defaultCollectionName, true) : undefined;

  // ── Variables ──────────────────────────────────────────────────────
  interface Pending {
    id: VariableId;
    raw: Record<ModeId, string>;
    isNew: boolean;
    typeFromAlias: boolean;
    replacedBy?: string;
  }
  const pending: Pending[] = [];
  const touched = new Set<VariableId>();
  const created: string[] = [];
  const updated: string[] = [];

  for (const entry of input.entries) {
    const label = entry.name ?? entry.id ?? "Untitled";
    let target: VariableCollection | undefined = defaultTarget;
    if (entry.collection !== undefined) {
      target = resolveCollection(entry.collection, false);
      if (!target) {
        errors.push(`variable "${label}": unknown collection "${entry.collection}". Define it in \`collections\` first. Known: ${collections.map((c) => c.name).join(", ")}.`);
        continue;
      }
    }

    let match = entry.id ? next.find((v) => v.id === entry.id) : undefined;
    if (!match && entry.name !== undefined) {
      const name = entry.name;
      const hits = next.filter(
        (v) => sameName(v.name, name) && (target === undefined || collectionIdOf(v) === target.id),
      );
      if (hits.length > 1) {
        const where = hits.map((v) => collections.find((c) => c.id === collectionIdOf(v))?.name ?? collectionIdOf(v));
        errors.push(`variable "${label}": the name is ambiguous (in collections ${where.join(", ")}). Set \`collection\` to choose one.`);
        continue;
      }
      match = hits[0];
    }
    if (match && isLibraryOwned(match)) {
      errors.push(`variable "${label}": ${libraryOwnedMessage("variable", match.name, match.libraryId as string)}`);
      continue;
    }
    if (!match && target && isLibraryOwned(target)) {
      errors.push(`variable "${label}": ${libraryOwnedMessage("collection", target.name, target.libraryId as string)} Cannot add variables to it.`);
      continue;
    }
    // A local token must not shadow a library token's CSS name.
    const wantedName = entry.name ?? (match ? undefined : "Untitled");
    if (wantedName !== undefined) {
      const css = getVariableCssName({ id: match?.id ?? entry.id ?? "", name: wantedName });
      const clash = next.find((v) => isLibraryOwned(v) && v.id !== match?.id && getVariableCssName(v) === css);
      if (clash) {
        errors.push(`variable "${label}": ${css} is already used by the library-owned, read-only token "${clash.name}".`);
        continue;
      }
    }
    if (match && entry.collection !== undefined && target && collectionIdOf(match) !== target.id) {
      errors.push(`variable "${label}": it lives in another collection; set_variables cannot move it.`);
      continue;
    }

    const own = match
      ? collections.find((c) => c.id === collectionIdOf(match as Variable))
      : (target ?? collections.find((c) => c.id === THEME_COLLECTION_ID));
    if (!own) {
      errors.push(`variable "${label}": its collection does not exist.`);
      continue;
    }

    // Mode names -> ids, per the variable's collection.
    const raw: Record<ModeId, string> = {};
    let modesOk = true;
    for (const [modeRef, value] of Object.entries(entry.modeValues ?? {})) {
      const mode = findMode(own, modeRef);
      if (!mode) {
        errors.push(`variable "${label}": unknown mode "${modeRef}" in collection "${own.name}" (modes: ${modeNames(own)}).`);
        modesOk = false;
        continue;
      }
      raw[mode.id] = value;
    }
    if (!modesOk) continue;

    if (match) {
      if (entry.value !== undefined) {
        // Explicit `valuesByMode` entries win over `value` (same as on create).
        const explicit = Object.keys(raw).length > 0;
        const current = modeValuesOf(match);
        const distinct = new Set(own.modes.map((m) => JSON.stringify(current[m.id] ?? null)));
        if (own.id === THEME_COLLECTION_ID && distinct.size <= 1) {
          // A single-valued Theme variable means "the one value": set every mode.
          for (const mode of own.modes) raw[mode.id] ??= entry.value;
        } else {
          raw[own.defaultModeId] ??= entry.value;
          if (own.modes.length > 1 && !explicit) {
            warnings.push(`"${label}": \`value\` set the default mode "${own.modes.find((m) => m.id === own.defaultModeId)?.name}" only. Use \`valuesByMode\` to set other modes.`);
          }
        }
      }
      const idx = next.indexOf(match);
      const patched: Variable = {
        ...match,
        collectionId: own.id,
        valuesByMode: modeValuesOf(match),
      };
      if (entry.name !== undefined) patched.name = entry.name;
      if (entry.type !== undefined) patched.type = entry.type;
      if (entry.description !== undefined) patched.description = entry.description;
      if (entry.scopes !== undefined) patched.scopes = entry.scopes;
      if (entry.deprecated !== undefined) {
        const { replacedBy: _ref, ...rest } = entry.deprecated;
        void _ref;
        patched.deprecated = { ...match.deprecated, ...rest };
      }
      next[idx] = patched;
      touched.add(patched.id);
      updated.push(patched.name);
      pending.push({ id: patched.id, raw, isNew: false, typeFromAlias: false, replacedBy: entry.deprecated?.replacedBy });
      continue;
    }

    // New variable: fill every mode.
    const defaultRaw = raw[own.defaultModeId];
    const fallbackRaw = entry.value ?? defaultRaw ?? Object.values(raw)[0];
    const hasRaw = Object.keys(raw).length > 0 || entry.value !== undefined;
    const filled: Record<ModeId, string> = {};
    for (const mode of own.modes) {
      const v = raw[mode.id] ?? (entry.value ?? fallbackRaw);
      if (v !== undefined) filled[mode.id] = v;
    }
    const firstRaw = Object.values(filled)[0];
    const aliasOnly = entry.type === undefined && firstRaw?.startsWith("$") === true;
    const type: VariableType = entry.type ?? "color";
    const variable: Variable = {
      id: entry.id || generateVariableId(),
      name: entry.name ?? "Untitled",
      type,
      collectionId: own.id,
      valuesByMode: {},
      value: "",
    };
    if (entry.description !== undefined) variable.description = entry.description;
    if (entry.scopes !== undefined) variable.scopes = entry.scopes;
    if (entry.deprecated !== undefined) {
      const { replacedBy: _ref, ...rest } = entry.deprecated;
      void _ref;
      variable.deprecated = rest;
    }
    next.push(variable);
    touched.add(variable.id);
    created.push(variable.name);
    const complete: Record<ModeId, string> = {};
    for (const mode of own.modes) complete[mode.id] = hasRaw ? (filled[mode.id] ?? TYPE_DEFAULTS[type]) : TYPE_DEFAULTS[type];
    pending.push({ id: variable.id, raw: complete, isNew: true, typeFromAlias: aliasOnly, replacedBy: entry.deprecated?.replacedBy });
  }

  // ── Resolve aliases, now that every variable of the call exists ────
  const byId = new Map(next.map((v) => [v.id, v]));
  const setType = (id: VariableId, type: VariableType): void => {
    const v = byId.get(id);
    if (v) v.type = type;
  };
  const lookup = (ref: string, label: string): Variable | undefined => {
    const hits = resolveVariableRef(next, collections, ref);
    if (hits.length === 1) return hits[0];
    errors.push(
      hits.length === 0
        ? `variable "${label}": alias target "$${stripVariableRef(ref)}" does not exist.`
        : `variable "${label}": alias target "$${stripVariableRef(ref)}" is ambiguous (${hits.length} variables).`,
    );
    return undefined;
  };

  // A variable with no type that only holds aliases takes the type of its target.
  for (let pass = 0; pass <= pending.length; pass++) {
    let changed = false;
    for (const p of pending) {
      if (!p.typeFromAlias) continue;
      const first = Object.values(p.raw).find((v) => v.startsWith("$"));
      const targets = first ? resolveVariableRef(next, collections, first) : [];
      if (targets.length === 1 && !pending.some((q) => q.typeFromAlias && q.id === targets[0].id)) {
        setType(p.id, targets[0].type);
        p.typeFromAlias = false;
        changed = true;
      }
    }
    if (!changed) break;
  }

  for (const p of pending) {
    const v = byId.get(p.id) as Variable;
    const resolved: Record<ModeId, VariableModeValue> = { ...(v.valuesByMode ?? {}) };
    for (const [modeId, rawValue] of Object.entries(p.raw)) {
      if (!rawValue.startsWith("$")) {
        resolved[modeId] = rawValue;
        continue;
      }
      const targetVar = lookup(rawValue, v.name);
      if (targetVar) resolved[modeId] = { alias: targetVar.id };
    }
    v.valuesByMode = resolved;
    if (p.replacedBy !== undefined) {
      const hits = resolveVariableRef(next, collections, p.replacedBy);
      const refusal = hits.length === 1 ? variableReplacementError(v, hits[0]) : null;
      if (refusal) errors.push(`variable "${v.name}": deprecated.replacedBy "${p.replacedBy}": ${refusal}`);
      else if (hits.length === 1) v.deprecated = { ...(v.deprecated ?? {}), replacedBy: hits[0].id };
      else errors.push(`variable "${v.name}": deprecated.replacedBy "${p.replacedBy}" ${hits.length === 0 ? "does not exist" : "is ambiguous"}.`);
    }
  }

  // Types of alias edges that touch a changed variable must agree.
  for (const v of next) {
    for (const entry of Object.values(modeValuesOf(v))) {
      if (typeof entry === "string") continue;
      const targetVar = byId.get(entry.alias);
      if (!targetVar || (!touched.has(v.id) && !touched.has(targetVar.id))) continue;
      if (targetVar.type !== v.type) {
        errors.push(`variable "${v.name}" (${v.type}) cannot alias "${targetVar.name}" (${targetVar.type}): the types differ.`);
      }
    }
  }

  for (const cycle of findCycles(next)) {
    if (cycle.some((id) => touched.has(id))) {
      errors.push(`alias cycle: ${cycle.map((id) => byId.get(id)?.name ?? id).join(" -> ")}.`);
    }
  }

  if (errors.length > 0) return { error: `set_variables changed nothing. ${errors.join(" ")}` };
  return { variables: next, collections, created, updated, warnings };
}
