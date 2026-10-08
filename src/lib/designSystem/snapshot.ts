// Builds a library snapshot (schemaVersion 1) from the open document: the
// variables and collections of the variable store plus the embed component
// masters. Library-owned items (copies of another library) and masters pinned
// to a library are left out: a library publishes only what it authors.
import { THEME_COLLECTION_ID, type Variable, type VariableCollection } from "@/types/variable";
import { modeValuesOf } from "@/lib/variables/variableIndex";
import { computeRev } from "@/lib/embedComponents/master";
import type { ComponentMaster, ComponentRegistry } from "@/lib/embedComponents/types";
import { useVariableStore } from "@/store/variableStore";
import { selectComponentRegistry } from "@/store/componentRegistry";
import { isLibraryComponent, isLibraryOwned } from "./ownership";
import {
  SUPPORTED_SCHEMA_VERSION,
  type Snapshot,
  type SnapshotComponent,
  type SnapshotDeprecation,
  type SnapshotVariable,
} from "./types";
import { checkSnapshotIntegrity, type SnapshotIssue } from "./validate";

export interface BuildSnapshotInput {
  variables: Variable[];
  collections: VariableCollection[];
  registry: ComponentRegistry;
  /** Markdown for `docs.readme`; omitted when blank. */
  readme?: string;
}

export interface BuildSnapshotResult {
  snapshot: Snapshot;
  /** Integrity problems the server would reject; empty when the snapshot can be published. */
  issues: SnapshotIssue[];
}

/** Copies the defined fields only, so `undefined` never reaches the hashed form. */
function cleanDeprecation(d: { since?: string; replacedBy?: string; note?: string } | undefined): SnapshotDeprecation | undefined {
  if (!d) return undefined;
  return {
    ...(d.since ? { since: d.since } : {}),
    ...(d.replacedBy ? { replacedBy: d.replacedBy } : {}),
    ...(d.note ? { note: d.note } : {}),
  };
}

function snapshotVariable(v: Variable): SnapshotVariable {
  const deprecated = cleanDeprecation(v.deprecated);
  return {
    id: v.id,
    name: v.name,
    type: v.type,
    collectionId: v.collectionId ?? THEME_COLLECTION_ID,
    valuesByMode: { ...modeValuesOf(v) },
    ...(v.description ? { description: v.description } : {}),
    ...(v.scopes && v.scopes.length > 0 ? { scopes: [...v.scopes] } : {}),
    ...(deprecated ? { deprecated } : {}),
  };
}

function snapshotComponent(master: ComponentMaster): SnapshotComponent {
  const { meta } = master;
  const deprecated = cleanDeprecation(meta.deprecated);
  return {
    key: master.key,
    html: master.html,
    rev: computeRev(master),
    meta: {
      name: meta.name,
      ...(meta.description ? { description: meta.description } : {}),
      ...(meta.variants && Object.keys(meta.variants).length > 0 ? { variants: meta.variants } : {}),
      ...(meta.status ? { status: meta.status } : {}),
      ...(deprecated ? { deprecated } : {}),
    },
  };
}

/** The pure builder: same input, same snapshot. Components are sorted by key so moving a master never changes the hash. */
export function buildSnapshotFrom(input: BuildSnapshotInput): BuildSnapshotResult {
  const collections = input.collections
    .filter((c) => !isLibraryOwned(c))
    .map((c) => ({
      id: c.id,
      name: c.name,
      modes: c.modes.map((m) => ({ id: m.id, name: m.name })),
      defaultModeId: c.defaultModeId,
    }));
  const variables = input.variables.filter((v) => !isLibraryOwned(v)).map(snapshotVariable);
  const components = [...input.registry.values()]
    .filter((m) => !isLibraryComponent(m.meta))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(snapshotComponent);
  const readme = input.readme?.trim() ? input.readme : undefined;
  const snapshot: Snapshot = {
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    collections,
    variables,
    components,
    ...(readme ? { docs: { readme } } : {}),
  };
  return { snapshot, issues: checkSnapshotIntegrity(snapshot) };
}

/** Builds the snapshot of the open document. `issues` holds the Theme-modes rule and every other integrity rule. */
export function buildSnapshot(options: { readme?: string } = {}): BuildSnapshotResult {
  const { variables, collections } = useVariableStore.getState();
  return buildSnapshotFrom({ variables, collections, registry: selectComponentRegistry(), readme: options.readme });
}
