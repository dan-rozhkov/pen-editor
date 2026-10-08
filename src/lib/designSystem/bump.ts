// Release planning: what bump a snapshot change needs, which versions the
// owner can pick, what the policy says, which migrations ship.
import { bumpRank, nextVersions } from "./semver";
import { checkRemovalPolicy, deriveMigrations, diffSnapshots } from "./diff";
import type { Bump, Migration, RequiredBump, Snapshot, SnapshotDiff, Violation } from "./types";

/** The smallest bump the change allows, or null for "nothing to publish" (no changes) and the first publish. */
export function suggestBump(required: RequiredBump): Bump | null {
  return required === "none" || required === "initial" ? null : required;
}

/** The owner may raise the bump, never lower it. */
export function isBumpAllowed(requested: Bump, required: RequiredBump): boolean {
  const min = suggestBump(required);
  return min === null || bumpRank(requested) >= bumpRank(min);
}

export interface ReleasePlan {
  diff: SnapshotDiff;
  requiredBump: RequiredBump;
  /** Removal-policy violations; a publish is refused while any exist. */
  violations: Violation[];
  /** `[]` whenever `violations` is not empty, as on the server. */
  migrations: Migration[];
  /** The version each bump would produce. */
  versions: Record<Bump, string>;
  /** No changes since the latest version: nothing to publish (`no_changes`). */
  noChanges: boolean;
  /** Publishable: changes exist (or this is the first publish) and the policy holds. */
  publishable: boolean;
}

/** Everything the Publish dialog shows, computed from the latest published snapshot (`null` = first publish) and the document's. */
export function planRelease(prev: Snapshot | null, next: Snapshot, latestVersion: string | null): ReleasePlan {
  const diff = diffSnapshots(prev, next);
  const violations = checkRemovalPolicy(prev, next);
  const noChanges = diff.requiredBump === "none";
  return {
    diff,
    requiredBump: diff.requiredBump,
    violations,
    migrations: violations.length === 0 ? deriveMigrations(prev, next) : [],
    versions: nextVersions(latestVersion),
    noChanges,
    publishable: !noChanges && violations.length === 0,
  };
}
