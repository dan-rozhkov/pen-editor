export * from "./types";
export { buildDesignSystem } from "./build";
export { componentTokens } from "./componentTokens";
export { resolveScope, findSavedScope, globToRegExp, globMatcher, escapeGlob, type ResolvedScope } from "./scope";
export { sanitizeDesignSystemScopes } from "./savedScopes";
export { canonicalJson } from "./canonical";
export * from "./semver";
export {
  checkRemovalPolicy,
  composeMigrations,
  cssNameOf,
  deriveMigrations,
  diffSnapshots,
  sortMigrations,
} from "./diff";
export { buildSnapshot, buildSnapshotFrom, type BuildSnapshotInput, type BuildSnapshotResult } from "./snapshot";
export { checkSnapshotIntegrity, validateSnapshot, type SnapshotIssue, type SnapshotValidation } from "./validate";
export { isBumpAllowed, planRelease, suggestBump, type ReleasePlan } from "./bump";
export {
  MAX_CHANGED_ENTRIES,
  buildChangelog,
  renderChangelogMarkdown,
  type Changelog,
  type ChangelogEntry,
  type ModeValueChange,
} from "./changelog";
export {
  applyDeprecationSince,
  deprecateComponent,
  deprecateVariable,
  stampDeprecationSince,
  undeprecateComponent,
  undeprecateVariable,
  type DeprecationInput,
  type DeprecationResult,
} from "./deprecation";
export {
  LIBRARY_COMPONENT_MESSAGE,
  isLibraryComponent,
  isLibraryOwned,
  libraryComponentError,
  libraryLabel,
  libraryOwnedMessage,
} from "./ownership";
