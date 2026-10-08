export * from "./types";
export { scopeCss, filterCssRules, rescopeCss } from "./css";
export {
  validateMaster,
  parseMaster,
  computeRev,
  effectiveVariants,
  shortHash,
  type ValidateMasterResult,
} from "./master";
export { renderInstance, renderRegionElement, readRegionSpec } from "./render";
export { expandComponentTags, mentionsRegisteredTag, type ExpandResult } from "./expand";
export {
  reconcileHtml,
  hasStaleRegions,
  countRegionsByKey,
  listRegionKeys,
  mayContainComponents,
  findManagedZoneViolation,
  detachRegions,
  type ManagedZoneViolation,
  type DetachResult,
} from "./reconcile";
export { findDependencyCycle, dependencyKeys } from "./cycles";
export { expandMasterHtml, finalizeEmbedHtml, describeUnknownTags, type FinalizeResult } from "./pipeline";
export {
  extractMasterDraft,
  replaceWithInstances,
  structuralSignature,
  type Extraction,
} from "./extract";
