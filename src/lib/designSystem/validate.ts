// Client-side mirror of the server's snapshot integrity checks
// (pen-editor-backend/src/ds/snapshotSchema.ts). The server stays the gate;
// this lets the editor refuse a bad snapshot before it uploads one, and
// refuse a newer-than-supported snapshot it downloaded.
import { THEME_COLLECTION_ID, type Variable } from "@/types/variable";
import { findCycles } from "@/lib/variables/aliasGraph";
import { COMPONENT_KEY_PATTERN } from "@/lib/embedComponents/types";
import { isRecord } from "@/lib/utils";
import { canonicalJson } from "./canonical";
import {
  MAX_README_BYTES,
  MAX_SNAPSHOT_BYTES,
  SUPPORTED_SCHEMA_VERSION,
  type Snapshot,
  type SnapshotCollection,
  type SnapshotVariable,
} from "./types";

export interface SnapshotIssue {
  path: string;
  message: string;
}

export type SnapshotValidation =
  | { ok: true; snapshot: Snapshot }
  | { ok: false; code: "invalid_snapshot" | "unsupported_schema"; message: string; issues: SnapshotIssue[] };

const byteLength = (text: string): number => new TextEncoder().encode(text).length;

const fail = (issues: SnapshotIssue[]): SnapshotValidation => ({
  ok: false,
  code: "invalid_snapshot",
  message: "The snapshot is not valid.",
  issues: issues.slice(0, 20),
});

/** True when a string anywhere in `value` (key or value) holds a real U+0000. */
function containsNul(value: unknown): boolean {
  if (typeof value === "string") return value.includes("\u0000");
  if (Array.isArray(value)) return value.some(containsNul);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).some(([k, v]) => k.includes("\u0000") || containsNul(v));
  }
  return false;
}

export function validateSnapshot(raw: unknown): SnapshotValidation {
  const candidate = raw as Partial<Snapshot> | null;
  const version = candidate?.schemaVersion;
  if (typeof version === "number" && version > SUPPORTED_SCHEMA_VERSION) {
    return {
      ok: false,
      code: "unsupported_schema",
      message: `Snapshot schemaVersion ${version} is newer than this editor supports (${SUPPORTED_SCHEMA_VERSION}). Update Sideform.`,
      issues: [],
    };
  }
  if (
    !candidate ||
    typeof candidate !== "object" ||
    version !== SUPPORTED_SCHEMA_VERSION ||
    !Array.isArray(candidate.collections) ||
    !Array.isArray(candidate.variables) ||
    !Array.isArray(candidate.components)
  ) {
    return fail([{ path: "", message: `Expected a snapshot with schemaVersion ${SUPPORTED_SCHEMA_VERSION} and collections, variables, components arrays.` }]);
  }
  const snapshot = candidate as Snapshot;
  if (containsNul(snapshot)) return fail([{ path: "", message: "Strings may not contain U+0000." }]);
  const shapeIssues = checkSnapshotShape(snapshot);
  if (shapeIssues.length > 0) return fail(shapeIssues);
  let issues: SnapshotIssue[];
  try {
    issues = checkSnapshotIntegrity(snapshot);
  } catch {
    return fail([{ path: "", message: "The snapshot has an unexpected structure." }]);
  }
  if (issues.length === 0 && byteLength(canonicalJson(snapshot)) > MAX_SNAPSHOT_BYTES) {
    issues.push({ path: "", message: "The snapshot is larger than 4 MB." });
  }
  return issues.length > 0 ? fail(issues) : { ok: true, snapshot };
}

/**
 * The nested shapes `checkSnapshotIntegrity` reads without checking. Untrusted
 * input (a downloaded snapshot) must produce issues here, never a throw there.
 */
export function checkSnapshotShape(s: Snapshot): SnapshotIssue[] {
  const issues: SnapshotIssue[] = [];
  const bad = (path: string, message: string) => issues.push({ path, message });
  const str = (x: unknown) => typeof x === "string";
  const deprecatedOk = (d: unknown) => d === undefined || (isRecord(d) && (d.replacedBy === undefined || str(d.replacedBy)));

  if (s.docs !== undefined && !(isRecord(s.docs) && str(s.docs.readme))) bad("docs", "docs.readme must be a string");
  (s.collections as unknown[]).forEach((c, i) => {
    if (!isRecord(c) || !str(c.id) || !str(c.name) || !str(c.defaultModeId) || !Array.isArray(c.modes)) {
      return bad(`collections.${i}`, "a collection needs string id, name and defaultModeId and a modes array");
    }
    if (!c.modes.every((m) => isRecord(m) && str(m.id) && str(m.name))) bad(`collections.${i}.modes`, "every mode needs a string id and name");
  });
  (s.variables as unknown[]).forEach((v, i) => {
    if (!isRecord(v) || !str(v.id) || !str(v.name) || !str(v.collectionId) || !str(v.type) || !isRecord(v.valuesByMode)) {
      return bad(`variables.${i}`, "a variable needs string id, name, collectionId and type and a valuesByMode object");
    }
    for (const [modeId, value] of Object.entries(v.valuesByMode)) {
      if (!str(value) && !(isRecord(value) && str(value.alias))) {
        bad(`variables.${i}.valuesByMode.${modeId}`, "a value must be a string or an {alias} object");
      }
    }
    if (!deprecatedOk(v.deprecated)) bad(`variables.${i}.deprecated`, "deprecated must be an object");
  });
  (s.components as unknown[]).forEach((c, i) => {
    if (!isRecord(c) || !str(c.key) || !isRecord(c.meta) || !str(c.meta.name)) {
      return bad(`components.${i}`, "a component needs a string key and a meta object with a string name");
    }
    if (!deprecatedOk(c.meta.deprecated)) bad(`components.${i}.meta.deprecated`, "deprecated must be an object");
  });
  return issues;
}

export function checkSnapshotIntegrity(s: Snapshot): SnapshotIssue[] {
  const issues: SnapshotIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  if (s.docs && byteLength(s.docs.readme) > MAX_README_BYTES) add("docs.readme", "readme is larger than 20 KB");

  const collections = new Map<string, SnapshotCollection>();
  s.collections.forEach((c, i) => {
    if (collections.has(c.id)) add(`collections.${i}.id`, `duplicate collection id "${c.id}"`);
    collections.set(c.id, c);
    const modeIds = new Set<string>();
    for (const m of c.modes) {
      if (modeIds.has(m.id)) add(`collections.${i}.modes`, `duplicate mode id "${m.id}"`);
      modeIds.add(m.id);
    }
    if (!modeIds.has(c.defaultModeId)) add(`collections.${i}.defaultModeId`, "defaultModeId is not one of the modes");
    if (c.id === THEME_COLLECTION_ID) {
      const ids = [...modeIds].sort().join(",");
      if (c.modes.length !== 2 || ids !== "dark,light") {
        add(`collections.${i}.modes`, 'the "theme" collection must have exactly the modes "light" and "dark"');
      }
    }
  });

  const variables = new Map<string, SnapshotVariable>();
  s.variables.forEach((v, i) => {
    if (variables.has(v.id)) add(`variables.${i}.id`, `duplicate variable id "${v.id}"`);
    variables.set(v.id, v);
  });
  s.variables.forEach((v, i) => {
    const collection = collections.get(v.collectionId);
    if (!collection) {
      add(`variables.${i}.collectionId`, `unknown collection "${v.collectionId}"`);
      return;
    }
    const modeIds = new Set(collection.modes.map((m) => m.id));
    for (const [modeId, value] of Object.entries(v.valuesByMode)) {
      if (!modeIds.has(modeId)) add(`variables.${i}.valuesByMode`, `unknown mode "${modeId}"`);
      if (typeof value === "string") continue;
      const target = variables.get(value.alias);
      if (!target) add(`variables.${i}.valuesByMode.${modeId}`, `alias target "${value.alias}" does not exist`);
      else if (target.type !== v.type) {
        add(`variables.${i}.valuesByMode.${modeId}`, `alias target "${value.alias}" has type ${target.type}, expected ${v.type}`);
      }
    }
    const replacedBy = v.deprecated?.replacedBy;
    if (replacedBy === undefined) return;
    if (replacedBy === v.id) add(`variables.${i}.deprecated.replacedBy`, "a variable cannot replace itself");
    else if (!variables.has(replacedBy)) add(`variables.${i}.deprecated.replacedBy`, `replacement "${replacedBy}" does not exist`);
  });
  const asVariables = s.variables.map((v) => ({ id: v.id, valuesByMode: v.valuesByMode }) as unknown as Variable);
  const cycle = findCycles(asVariables)[0];
  if (cycle) add("variables", `alias cycle through "${cycle[0]}"`);

  const keys = new Set<string>();
  s.components.forEach((c, i) => {
    if (!COMPONENT_KEY_PATTERN.test(c.key) || c.key === "slot") add(`components.${i}.key`, `invalid component key "${c.key}"`);
    if (keys.has(c.key)) add(`components.${i}.key`, `duplicate component key "${c.key}"`);
    keys.add(c.key);
  });
  s.components.forEach((c, i) => {
    const replacedBy = c.meta.deprecated?.replacedBy;
    if (replacedBy === undefined) return;
    if (replacedBy === c.key) add(`components.${i}.meta.deprecated.replacedBy`, "a component cannot replace itself");
    else if (!keys.has(replacedBy)) add(`components.${i}.meta.deprecated.replacedBy`, `replacement "${replacedBy}" does not exist`);
  });
  return issues;
}
