// Snapshot v1: the wire shape of one published library version. Mirrors
// pen-editor-backend/src/ds/snapshotSchema.ts; the spec is
// docs/superpowers/specs/2026-10-08-ds-library-snapshot-v1.md.

export const SUPPORTED_SCHEMA_VERSION = 1;
export const MAX_README_BYTES = 20 * 1024;
export const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;

export type SnapshotModeValue = string | { alias: string };

export interface SnapshotDeprecation {
  since?: string;
  replacedBy?: string;
  note?: string;
}

export interface SnapshotCollection {
  id: string;
  name: string;
  modes: Array<{ id: string; name: string }>;
  defaultModeId: string;
}

export interface SnapshotVariable {
  id: string;
  name: string;
  type: "color" | "number" | "string";
  collectionId: string;
  valuesByMode: Record<string, SnapshotModeValue>;
  description?: string;
  scopes?: string[];
  deprecated?: SnapshotDeprecation;
}

export interface SnapshotComponent {
  key: string;
  html: string;
  rev: string;
  meta: {
    name: string;
    description?: string;
    variants?: Record<string, string[]>;
    status?: "draft" | "stable" | "deprecated";
    deprecated?: SnapshotDeprecation;
  };
}

export interface Snapshot {
  schemaVersion: number;
  collections: SnapshotCollection[];
  variables: SnapshotVariable[];
  components: SnapshotComponent[];
  docs?: { readme: string };
}

export type Bump = "major" | "minor" | "patch";
export type RequiredBump = Bump | "none" | "initial";
export type ChangeKind = "added" | "removed" | "changed" | "deprecated";

export interface Change {
  kind: ChangeKind;
  /** `collection:<id>`, `mode:<collectionId>/<modeId>`, `variable:<id>`, `component:<key>`, or `snapshot`. */
  entity: string;
  bump: Bump;
  reason: string;
}

export interface DiffSummary {
  added: number;
  changed: number;
  deprecated: number;
  removed: number;
}

export interface SnapshotDiff {
  requiredBump: RequiredBump;
  changes: Change[];
  summary: DiffSummary;
  /** Entities present before and gone now, sorted. */
  removed: string[];
  /** Entities new in `next`, sorted. */
  added: string[];
}

export interface Violation {
  code: "removal_not_deprecated" | "replacement_missing" | "replacement_type_mismatch";
  entity: string;
  message: string;
}

export type Migration =
  | { op: "rebindToken"; from: string; to: string; cssFrom: string; cssTo: string }
  /** A surviving variable whose CSS name changed: `var(cssFrom)` in consumer markup becomes `var(cssTo)`. */
  | { op: "renameToken"; id: string; cssFrom: string; cssTo: string }
  /** `valueFrom` is set only by composition: freeze `id` with the value of that (rebound-to) token instead of its own. */
  | { op: "freezeToken"; id: string; valueFrom?: string }
  | { op: "remapComponent"; from: string; to: string }
  | { op: "removeComponent"; key: string }
  | { op: "dropMode"; collection: string; mode: string }
  | { op: "remapVariant"; key: string; axis: string; map: Record<string, string> };

/** One library a document is linked to. */
export interface LibraryPin {
  id: string;
  name: string;
  version: string;
  /** Opt-in usage upload (Phase 7). Stripped from shared documents. */
  reportUsage?: boolean;
  /** The newest version the user chose to ignore ("stay pinned"). */
  dismissedVersion?: string;
}

/** Set on the document that authors a library. */
export interface LibraryAuthor {
  libraryId: string;
  /** The latest version this document was diffed against, or null before the first publish. */
  baseVersion: string | null;
  name: string;
}

/** Records one change while a diff walks the snapshots. */
export type ChangeSink = (kind: ChangeKind, entity: string, bump: Bump, reason: string) => void;
