// The changelog of one release: the diff grouped by entity, with the RESOLVED
// old -> new value per mode for tokens (so an alias retarget reads as a color
// change). Display only: the server gates on its own structural diff and just
// validates the shape and size (at most 512 KB) of what we send.
import type { Variable } from "@/types/variable";
import { buildVariableIndex } from "@/lib/variables/variableIndex";
import { resolveVariable } from "@/lib/variables/resolve";
import { bumpRank } from "./semver";
import type { Bump, ChangeKind, Snapshot, SnapshotDiff, SnapshotVariable } from "./types";

/** `changed` entries kept in a changelog; the rest are counted in `omitted`. */
export const MAX_CHANGED_ENTRIES = 500;

export interface ModeValueChange {
  modeId: string;
  modeName: string;
  /** Resolved value before; absent when the mode is new. */
  from?: string;
  /** Resolved value after; absent when the mode is gone. */
  to?: string;
  /** Name of the aliased token before / after, when the entry is an alias. */
  fromAlias?: string;
  toAlias?: string;
}

export interface ChangelogEntry {
  kind: ChangeKind;
  entity: string;
  /** Display name (token or component name, collection name, or the entity string). */
  name: string;
  bump: Bump;
  reasons: string[];
  values?: ModeValueChange[];
}

export interface Changelog {
  fromVersion: string | null;
  toVersion: string;
  bump: Bump | "initial";
  summary: SnapshotDiff["summary"];
  entries: ChangelogEntry[];
  /** `changed` entries dropped over the cap. */
  omitted: number;
}

const KIND_PRIORITY: ChangeKind[] = ["removed", "added", "deprecated", "changed"];

function toVariables(s: Snapshot): Variable[] {
  return s.variables.map((v) => ({ ...v, value: "" }) as unknown as Variable);
}

function displayName(entity: string, prev: Snapshot, next: Snapshot): string {
  const sep = entity.indexOf(":");
  const kind = entity.slice(0, sep);
  const id = entity.slice(sep + 1);
  if (kind === "variable") {
    return (next.variables.find((v) => v.id === id) ?? prev.variables.find((v) => v.id === id))?.name ?? id;
  }
  if (kind === "component") {
    return (next.components.find((c) => c.key === id) ?? prev.components.find((c) => c.key === id))?.meta.name ?? id;
  }
  if (kind === "collection") {
    return (next.collections.find((c) => c.id === id) ?? prev.collections.find((c) => c.id === id))?.name ?? id;
  }
  return entity;
}

/** Resolved per-mode values of one token before and after; only modes that differ. */
function valueChanges(
  p: SnapshotVariable,
  n: SnapshotVariable,
  prev: Snapshot,
  next: Snapshot,
  indexes: { prev: ReturnType<typeof buildVariableIndex>; next: ReturnType<typeof buildVariableIndex> },
): ModeValueChange[] {
  const out: ModeValueChange[] = [];
  const nameOf = (s: Snapshot, id: string) => s.variables.find((v) => v.id === id)?.name ?? id;
  const modeName = (variable: SnapshotVariable, snap: Snapshot, modeId: string): string | undefined =>
    snap.collections.find((c) => c.id === variable.collectionId)?.modes.find((m) => m.id === modeId)?.name;
  const modeIds = [...new Set([...Object.keys(p.valuesByMode), ...Object.keys(n.valuesByMode)])];
  for (const modeId of modeIds) {
    const before = p.valuesByMode[modeId];
    const after = n.valuesByMode[modeId];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    const resolve = (index: typeof indexes.prev, v: SnapshotVariable, entry: unknown) => {
      if (entry === undefined) return undefined;
      const r = resolveVariable(index, v.id, { [v.collectionId]: modeId });
      return r.ok ? r.value : typeof entry === "string" ? entry : undefined;
    };
    const from = resolve(indexes.prev, p, before);
    const to = resolve(indexes.next, n, after);
    out.push({
      modeId,
      modeName: modeName(n, next, modeId) ?? modeName(p, prev, modeId) ?? modeId,
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {}),
      ...(before && typeof before !== "string" ? { fromAlias: nameOf(prev, before.alias) } : {}),
      ...(after && typeof after !== "string" ? { toAlias: nameOf(next, after.alias) } : {}),
    });
  }
  return out;
}

export function buildChangelog(
  prev: Snapshot | null,
  next: Snapshot,
  diff: SnapshotDiff,
  versions: { from: string | null; to: string },
): Changelog {
  const base: Omit<Changelog, "entries" | "omitted"> = {
    fromVersion: versions.from,
    toVersion: versions.to,
    bump: diff.requiredBump === "none" ? "patch" : diff.requiredBump,
    summary: diff.summary,
  };
  if (prev === null) return { ...base, entries: [], omitted: 0 };

  const indexes = {
    prev: buildVariableIndex(toVariables(prev), prev.collections),
    next: buildVariableIndex(toVariables(next), next.collections),
  };
  const grouped = new Map<string, ChangelogEntry>();
  for (const change of diff.changes) {
    let entry = grouped.get(change.entity);
    if (!entry) {
      entry = { kind: change.kind, entity: change.entity, name: displayName(change.entity, prev, next), bump: change.bump, reasons: [] };
      grouped.set(change.entity, entry);
    }
    if (KIND_PRIORITY.indexOf(change.kind) < KIND_PRIORITY.indexOf(entry.kind)) entry.kind = change.kind;
    if (bumpRank(change.bump) > bumpRank(entry.bump)) entry.bump = change.bump;
    if (!entry.reasons.includes(change.reason)) entry.reasons.push(change.reason);
  }
  for (const entry of grouped.values()) {
    if (!entry.entity.startsWith("variable:") || !entry.reasons.includes("value changed")) continue;
    const id = entry.entity.slice("variable:".length);
    const p = prev.variables.find((v) => v.id === id);
    const n = next.variables.find((v) => v.id === id);
    if (p && n) entry.values = valueChanges(p, n, prev, next, indexes);
  }

  const all = [...grouped.values()].sort(
    (a, b) => KIND_PRIORITY.indexOf(a.kind) - KIND_PRIORITY.indexOf(b.kind) || a.entity.localeCompare(b.entity),
  );
  const changed = all.filter((e) => e.kind === "changed");
  const keptChanged = new Set(changed.slice(0, MAX_CHANGED_ENTRIES));
  return {
    ...base,
    entries: all.filter((e) => e.kind !== "changed" || keptChanged.has(e)),
    omitted: Math.max(0, changed.length - MAX_CHANGED_ENTRIES),
  };
}

const SECTIONS: Array<{ title: string; match: (e: ChangelogEntry) => boolean }> = [
  { title: "Breaking", match: (e) => e.bump === "major" },
  { title: "Added", match: (e) => e.bump !== "major" && e.kind === "added" },
  { title: "Deprecated", match: (e) => e.bump !== "major" && e.kind === "deprecated" },
  { title: "Changed", match: (e) => e.bump !== "major" && e.kind === "changed" },
];

function describeValues(values: ModeValueChange[]): string {
  return values
    .map((v) => `${v.modeName}: ${v.from ?? "(none)"} -> ${v.to ?? "(removed)"}`)
    .join("; ");
}

export function renderChangelogMarkdown(changelog: Changelog): string {
  const lines = [`## ${changelog.toVersion}`, ""];
  const lead = changelog.fromVersion ? `Changes since ${changelog.fromVersion}.` : "First release.";
  lines.push(lead, "");
  for (const section of SECTIONS) {
    const entries = changelog.entries.filter(section.match);
    if (entries.length === 0) continue;
    lines.push(`### ${section.title}`, "");
    for (const e of entries) {
      const detail = e.values && e.values.length > 0 ? ` (${describeValues(e.values)})` : "";
      lines.push(`- ${e.name} [${e.entity}]: ${e.reasons.join(", ")}${detail}`);
    }
    lines.push("");
  }
  if (changelog.omitted > 0) lines.push(`${changelog.omitted} more changed entries are not listed.`, "");
  return lines.join("\n").trimEnd() + "\n";
}
