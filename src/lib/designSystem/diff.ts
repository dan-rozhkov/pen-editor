// Structural diff of two library snapshots: the required semver bump, the
// removal (deprecation) policy and the migrations a consumer applies when it
// updates. It mirrors pen-editor-backend/src/ds/diff.ts rule for rule; the
// server's result gates a publish, ours only previews it. The golden fixtures
// (__tests__/fixtures, contract-tested against the backend copy) keep both in
// agreement. No value resolver here: resolved old -> new values for display
// live in changelog.ts.
import { getVariableCssName } from "@/types/variable";
import { canonicalJson } from "./canonical";
import { bumpRank } from "./semver";
import type {
  Bump,
  Change,
  ChangeKind,
  ChangeSink,
  Migration,
  RequiredBump,
  Snapshot,
  SnapshotComponent,
  SnapshotDiff,
  SnapshotVariable,
  Violation,
} from "./types";

const slotsOf = (html: string): string[] => {
  const out = new Set<string>();
  for (const m of html.matchAll(/data-c-slot\s*=\s*["']([^"']+)["']/g)) out.add(m[1]);
  return [...out];
};

/** The CSS custom-property name a snapshot variable resolves to (same rule as the editor). */
export const cssNameOf = (v: Pick<SnapshotVariable, "id" | "name">): string => getVariableCssName(v);

const byId = <T>(items: T[], key: (item: T) => string): Map<string, T> => new Map(items.map((i) => [key(i), i]));

const same = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);

export function diffSnapshots(prev: Snapshot | null, next: Snapshot): SnapshotDiff {
  const changes: Change[] = [];
  const removed: string[] = [];
  const added: string[] = [];
  const push: ChangeSink = (kind, entity, bump, reason) => {
    changes.push({ kind, entity, bump, reason });
    if (kind === "removed") removed.push(entity);
    if (kind === "added") added.push(entity);
  };

  if (prev === null) {
    return { requiredBump: "initial", changes, summary: { added: 0, changed: 0, deprecated: 0, removed: 0 }, removed, added };
  }

  // Collections and modes.
  const prevCollections = byId(prev.collections, (c) => c.id);
  const nextCollections = byId(next.collections, (c) => c.id);
  for (const [cid, c] of prevCollections) {
    const n = nextCollections.get(cid);
    if (!n) {
      push("removed", `collection:${cid}`, "major", "collection removed");
      continue;
    }
    const modeChangesBefore = changes.length;
    const nextModes = new Set(n.modes.map((m) => m.id));
    const prevModes = new Set(c.modes.map((m) => m.id));
    for (const m of c.modes) {
      if (!nextModes.has(m.id)) push("removed", `mode:${cid}/${m.id}`, "major", "mode removed");
    }
    for (const m of n.modes) {
      if (!prevModes.has(m.id)) push("added", `mode:${cid}/${m.id}`, "minor", "mode added");
    }
    if (changes.length === modeChangesBefore && !same(c.modes, n.modes)) {
      push("changed", `collection:${cid}`, "patch", "mode names or order changed");
    }
    if (c.name !== n.name || c.defaultModeId !== n.defaultModeId) {
      push("changed", `collection:${cid}`, "patch", "collection name or default mode changed");
    }
  }
  for (const cid of nextCollections.keys()) {
    if (!prevCollections.has(cid)) push("added", `collection:${cid}`, "minor", "collection added");
  }

  // Variables.
  const prevVars = byId(prev.variables, (v) => v.id);
  const nextVars = byId(next.variables, (v) => v.id);
  for (const [vid, p] of prevVars) {
    const n = nextVars.get(vid);
    const entity = `variable:${vid}`;
    if (!n) {
      push("removed", entity, "major", "variable removed");
      continue;
    }
    diffVariable(p, n, entity, push);
  }
  for (const vid of nextVars.keys()) {
    if (!prevVars.has(vid)) push("added", `variable:${vid}`, "minor", "variable added");
  }

  // Components.
  const prevComps = byId(prev.components, (c) => c.key);
  const nextComps = byId(next.components, (c) => c.key);
  for (const [key, p] of prevComps) {
    const n = nextComps.get(key);
    if (!n) {
      push("removed", `component:${key}`, "major", "component removed");
      continue;
    }
    diffComponent(p, n, push);
  }
  for (const key of nextComps.keys()) {
    if (!prevComps.has(key)) push("added", `component:${key}`, "minor", "component added");
  }

  if (!same(prev.docs ?? null, next.docs ?? null)) push("changed", "snapshot", "patch", "docs changed");
  if (changes.length === 0 && !same(prev, next)) push("changed", "snapshot", "patch", "ordering changed");

  let requiredBump: RequiredBump = "none";
  for (const c of changes) {
    if (requiredBump === "none" || bumpRank(c.bump) > bumpRank(requiredBump as Bump)) requiredBump = c.bump;
  }
  const count = (kind: ChangeKind) => new Set(changes.filter((c) => c.kind === kind).map((c) => c.entity)).size;
  return {
    requiredBump,
    changes,
    summary: { added: count("added"), changed: count("changed"), deprecated: count("deprecated"), removed: count("removed") },
    removed: removed.sort(),
    added: added.sort(),
  };
}

function diffDeprecation(
  p: { deprecated?: unknown },
  n: { deprecated?: unknown },
  entity: string,
  noun: string,
  push: ChangeSink,
): void {
  if (!p.deprecated && n.deprecated) push("deprecated", entity, "minor", `${noun} deprecated`);
  else if (p.deprecated && !n.deprecated) push("changed", entity, "patch", `${noun} un-deprecated`);
  else if (!same(p.deprecated, n.deprecated)) push("changed", entity, "patch", "deprecation details changed");
}

function diffVariable(p: SnapshotVariable, n: SnapshotVariable, entity: string, push: ChangeSink): void {
  if (p.type !== n.type) push("changed", entity, "major", "variable type changed");
  if (p.collectionId !== n.collectionId) push("changed", entity, "major", "variable moved to another collection");
  diffDeprecation(p, n, entity, "variable", push);
  if (!same(p.valuesByMode, n.valuesByMode)) push("changed", entity, "patch", "value changed");
  // A new CSS name breaks every consumer var(--old): major, with a rename migration.
  const renamed = cssNameOf(p) !== cssNameOf(n);
  const docsChanged = p.description !== n.description || !same(p.scopes, n.scopes);
  if (renamed) push("changed", entity, "major", "CSS name changed");
  else if (p.name !== n.name || docsChanged) push("changed", entity, "patch", "name, description or scopes changed");
  if (renamed && docsChanged) push("changed", entity, "patch", "description or scopes changed");
}

function diffComponent(p: SnapshotComponent, n: SnapshotComponent, push: ChangeSink): void {
  const entity = `component:${p.key}`;
  const pv = p.meta.variants ?? {};
  const nv = n.meta.variants ?? {};
  for (const [axis, values] of Object.entries(pv)) {
    if (!(axis in nv)) {
      push("changed", entity, "major", `variant axis "${axis}" removed`);
      continue;
    }
    const kept = new Set(nv[axis]);
    for (const value of values) if (!kept.has(value)) push("changed", entity, "major", `value "${value}" of axis "${axis}" removed`);
    const old = new Set(values);
    for (const value of nv[axis]) if (!old.has(value)) push("changed", entity, "minor", `value "${value}" of axis "${axis}" added`);
  }
  for (const axis of Object.keys(nv)) if (!(axis in pv)) push("changed", entity, "minor", `variant axis "${axis}" added`);

  const pSlots = slotsOf(p.html);
  const nSlots = new Set(slotsOf(n.html));
  const oldSlots = new Set(pSlots);
  for (const slot of pSlots) if (!nSlots.has(slot)) push("changed", entity, "major", `slot "${slot}" removed`);
  for (const slot of nSlots) if (!oldSlots.has(slot)) push("changed", entity, "minor", `slot "${slot}" added`);

  diffDeprecation(p.meta, n.meta, entity, "component", push);

  if (p.html !== n.html || p.rev !== n.rev) push("changed", entity, "patch", "markup or styles changed");
  if (p.meta.name !== n.meta.name || p.meta.description !== n.meta.description || p.meta.status !== n.meta.status) {
    push("changed", entity, "patch", "name, description or status changed");
  }
}

/**
 * A removal is allowed only if the entity in the PREVIOUS snapshot was already
 * deprecated with a replacement or a non-empty note, and any replacement still
 * exists in `next` (with a compatible type, for tokens).
 */
export function checkRemovalPolicy(prev: Snapshot | null, next: Snapshot): Violation[] {
  if (prev === null) return [];
  const violations: Violation[] = [];
  const nextVars = byId(next.variables, (v) => v.id);
  const nextComps = byId(next.components, (c) => c.key);

  for (const v of prev.variables) {
    if (nextVars.has(v.id)) continue;
    const entity = `variable:${v.id}`;
    const d = v.deprecated;
    if (!d || (!d.replacedBy && !d.note?.trim())) {
      violations.push({ code: "removal_not_deprecated", entity, message: `Variable "${v.name}" was removed without being deprecated first.` });
      continue;
    }
    if (d.replacedBy) {
      const target = nextVars.get(d.replacedBy);
      if (!target) violations.push({ code: "replacement_missing", entity, message: `The replacement "${d.replacedBy}" of variable "${v.name}" is not in the new snapshot.` });
      else if (target.type !== v.type) {
        violations.push({ code: "replacement_type_mismatch", entity, message: `The replacement of variable "${v.name}" has type ${target.type}, expected ${v.type}.` });
      }
    }
  }
  for (const c of prev.components) {
    if (nextComps.has(c.key)) continue;
    const entity = `component:${c.key}`;
    const d = c.meta.deprecated;
    if (!d || (!d.replacedBy && !d.note?.trim())) {
      violations.push({ code: "removal_not_deprecated", entity, message: `Component "${c.meta.name}" was removed without being deprecated first.` });
      continue;
    }
    if (d.replacedBy && !nextComps.has(d.replacedBy)) {
      violations.push({ code: "replacement_missing", entity, message: `The replacement "${d.replacedBy}" of component "${c.meta.name}" is not in the new snapshot.` });
    }
  }
  return violations.sort((a, b) => a.entity.localeCompare(b.entity));
}

const OP_ORDER: Migration["op"][] = ["renameToken", "rebindToken", "freezeToken", "remapComponent", "removeComponent", "dropMode", "remapVariant"];

function opKey(m: Migration): string {
  switch (m.op) {
    case "rebindToken":
    case "remapComponent":
      return m.from;
    case "renameToken":
    case "freezeToken":
      return m.id;
    case "removeComponent":
      return m.key;
    case "dropMode":
      return `${m.collection}/${m.mode}`;
    case "remapVariant":
      return `${m.key}/${m.axis}`;
  }
}

export function sortMigrations(migrations: Migration[]): Migration[] {
  return [...migrations].sort((a, b) => OP_ORDER.indexOf(a.op) - OP_ORDER.indexOf(b.op) || opKey(a).localeCompare(opKey(b)));
}

/** Migrations for the removals and renames between two snapshots. Call after the policy check passed. */
export function deriveMigrations(prev: Snapshot | null, next: Snapshot): Migration[] {
  if (prev === null) return [];
  const out: Migration[] = [];
  const nextVars = byId(next.variables, (v) => v.id);
  const nextComps = byId(next.components, (c) => c.key);
  const nextCollections = byId(next.collections, (c) => c.id);

  for (const v of prev.variables) {
    const kept = nextVars.get(v.id);
    if (kept) {
      const cssFrom = cssNameOf(v);
      const cssTo = cssNameOf(kept);
      if (cssFrom !== cssTo) out.push({ op: "renameToken", id: v.id, cssFrom, cssTo });
      continue;
    }
    const target = v.deprecated?.replacedBy ? nextVars.get(v.deprecated.replacedBy) : undefined;
    if (target) out.push({ op: "rebindToken", from: v.id, to: target.id, cssFrom: cssNameOf(v), cssTo: cssNameOf(target) });
    else if (v.deprecated?.note?.trim() || v.deprecated?.replacedBy) out.push({ op: "freezeToken", id: v.id });
  }
  for (const c of prev.components) {
    if (nextComps.has(c.key)) continue;
    const to = c.meta.deprecated?.replacedBy;
    if (to && nextComps.has(to)) out.push({ op: "remapComponent", from: c.key, to });
    else if (c.meta.deprecated) out.push({ op: "removeComponent", key: c.key });
  }
  for (const c of prev.collections) {
    const n = nextCollections.get(c.id);
    if (!n) continue;
    const kept = new Set(n.modes.map((m) => m.id));
    for (const m of c.modes) if (!kept.has(m.id)) out.push({ op: "dropMode", collection: c.id, mode: m.id });
  }
  return sortMigrations(out);
}

/**
 * Folds the migrations of consecutive versions (oldest first) into one list
 * that takes a document straight from the first version to the last, with the
 * same result as applying every step in turn. A chain A -> B -> C becomes
 * A -> C and B -> C; renames of one token collapse; a rebind follows the CSS
 * name of its target; a token rebound to something that is frozen later is
 * frozen itself, with the value of the token it had been rebound to. Each op
 * rewrites existing entries once, so a cycle (an id that comes back) cannot loop.
 */
export function composeMigrations(steps: Migration[][]): Migration[] {
  type Rebind = Extract<Migration, { op: "rebindToken" }>;
  type Rename = Extract<Migration, { op: "renameToken" }>;
  const rebinds = new Map<string, Rebind>();
  const renames = new Map<string, Rename>();
  /** frozen id -> id whose value it is frozen with. */
  const frozen = new Map<string, string>();
  const remaps = new Map<string, string>();
  const removedComponents = new Set<string>();
  const others = new Map<string, Migration>();

  for (const op of steps.flat()) {
    switch (op.op) {
      case "renameToken": {
        // Earlier rebinds into this token must write its new CSS name.
        for (const [from, r] of rebinds) if (r.to === op.id) rebinds.set(from, { ...r, cssTo: op.cssTo });
        if (frozen.has(op.id) || rebinds.has(op.id)) break;
        const cssFrom = renames.get(op.id)?.cssFrom ?? op.cssFrom;
        if (cssFrom === op.cssTo) renames.delete(op.id);
        else renames.set(op.id, { op: "renameToken", id: op.id, cssFrom, cssTo: op.cssTo });
        break;
      }
      case "rebindToken": {
        for (const [from, r] of rebinds) {
          if (r.to !== op.from) continue;
          if (from === op.to) rebinds.delete(from);
          else rebinds.set(from, { ...r, to: op.to, cssTo: op.cssTo });
        }
        // The token was renamed first: consumer markup still has its original CSS name.
        const renamedFrom = renames.get(op.from)?.cssFrom;
        renames.delete(op.from);
        if (op.from !== op.to && !rebinds.has(op.from) && !frozen.has(op.from)) {
          rebinds.set(op.from, renamedFrom === undefined ? op : { ...op, cssFrom: renamedFrom });
        }
        break;
      }
      case "freezeToken": {
        for (const [from, r] of rebinds) {
          if (r.to === op.id) {
            rebinds.delete(from);
            frozen.set(from, op.id);
          }
        }
        renames.delete(op.id);
        if (!rebinds.has(op.id) && !frozen.has(op.id)) frozen.set(op.id, op.id);
        break;
      }
      case "remapComponent": {
        for (const [from, to] of remaps) {
          if (to !== op.from) continue;
          if (from === op.to) remaps.delete(from);
          else remaps.set(from, op.to);
        }
        if (op.from !== op.to && !remaps.has(op.from) && !removedComponents.has(op.from)) remaps.set(op.from, op.to);
        break;
      }
      case "removeComponent": {
        for (const [from, to] of remaps) {
          if (to === op.key) {
            remaps.delete(from);
            removedComponents.add(from);
          }
        }
        if (!remaps.has(op.key)) removedComponents.add(op.key);
        break;
      }
      default:
        others.set(`${op.op}:${opKey(op)}`, op);
    }
  }
  return sortMigrations([
    ...renames.values(),
    ...rebinds.values(),
    ...[...frozen].map(([id, source]): Migration => (source === id ? { op: "freezeToken", id } : { op: "freezeToken", id, valueFrom: source })),
    ...[...remaps].map(([from, to]): Migration => ({ op: "remapComponent", from, to })),
    ...[...removedComponents].map((key): Migration => ({ op: "removeComponent", key })),
    ...others.values(),
  ]);
}
