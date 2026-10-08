import {
  getVariableCssName,
  type ModeContext,
  type Variable,
  type VariableCollection,
} from "@/types/variable";
import {
  buildVariableIndex,
  collectionIdOf,
  completeModeContext,
  modeValuesOf,
  type VariableIndex,
} from "@/lib/variables";
import { effectiveVariants, parseMaster } from "@/lib/embedComponents";
import { formatVariableRef } from "@/lib/tools/variableToolUtils";
import { describeModeValues, readModeArg } from "@/lib/tools/variableValues";
import { componentTokens } from "./componentTokens";
import { resolveScope, type ResolvedScope } from "./scope";
import {
  DEFAULT_LIMIT,
  type ComponentInput,
  type DesignSystemArgs,
  type DesignSystemCollection,
  type DesignSystemComponent,
  type DesignSystemInput,
  type DesignSystemResult,
  type DesignSystemSection,
  type DesignSystemToken,
} from "./types";

const MAX_LIMIT = 5000;
const DEFAULT_SECTIONS: readonly DesignSystemSection[] = ["tokens", "components"];

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

/** `semantic` when a variable of the collection aliases a variable of another collection. */
function tierOf(collection: VariableCollection, variables: Variable[], index: VariableIndex): "primitive" | "semantic" {
  for (const v of variables) {
    if (collectionIdOf(v) !== collection.id) continue;
    for (const entry of Object.values(modeValuesOf(v))) {
      if (typeof entry === "string") continue;
      const target = index.byId.get(entry.alias);
      if (target && collectionIdOf(target) !== collection.id) return "semantic";
    }
  }
  return "primitive";
}

function describeToken(
  v: Variable,
  collection: VariableCollection,
  ctx: ModeContext,
  modeFilter: Set<string> | undefined,
  input: DesignSystemInput,
  index: VariableIndex,
  allCollections: VariableCollection[],
): DesignSystemToken {
  const values = describeModeValues(v, collection, ctx, modeFilter, index, input.variables, allCollections);
  const replacedBy = v.deprecated?.replacedBy ? index.byId.get(v.deprecated.replacedBy) : undefined;
  return {
    name: v.name,
    cssName: getVariableCssName(v),
    collection: collection.name,
    type: v.type,
    scopes: v.scopes ?? [],
    ...(v.description ? { description: v.description } : {}),
    values,
    ...(v.deprecated
      ? {
          deprecated: {
            ...(v.deprecated.since ? { since: v.deprecated.since } : {}),
            ...(v.deprecated.replacedBy
              ? { replacedBy: replacedBy ? formatVariableRef(input.variables, allCollections, replacedBy) : `$${v.deprecated.replacedBy}` }
              : {}),
            ...(v.deprecated.note ? { note: v.deprecated.note } : {}),
          },
        }
      : {}),
  };
}

/** A variable with no scopes is usable anywhere, so a scope filter never hides it. */
function hasTokenScope(v: Variable, scope: ResolvedScope): boolean {
  return !scope.tokenScopes || !v.scopes || v.scopes.length === 0 || v.scopes.some((s) => scope.tokenScopes?.has(s));
}

const matchesNames = (v: Variable, scope: ResolvedScope): boolean =>
  !scope.names || scope.names(v.name, getVariableCssName(v));

const keepKey = (c: ComponentInput, scope: ResolvedScope): boolean =>
  !scope.componentKeys || scope.componentKeys.has(c.master.key);

const keepStatus = (c: ComponentInput, scope: ResolvedScope): boolean =>
  !scope.componentStatus || scope.componentStatus.has(c.master.meta.status ?? "stable");

/**
 * Apply the filters one after another; when a stage takes the count from some
 * to zero, name it. Null when the result is not empty or nothing was there.
 */
function emptiedBy<T>(items: T[], stages: [label: string, applied: string[] | undefined, keep: (x: T) => boolean][]): string | null {
  let rest = items;
  for (const [label, applied, keep] of stages) {
    if (rest.length === 0) return null;
    rest = rest.filter(keep);
    if (rest.length === 0) return applied && applied.length > 0 ? `${label} (${applied.join(", ")})` : label;
  }
  return null;
}

function describeComponent(
  c: ComponentInput,
  input: DesignSystemInput,
  index: VariableIndex,
  ctx: ModeContext,
): DesignSystemComponent {
  const { master } = c;
  const parsed = parseMaster(master);
  const deprecated = master.meta.deprecated;
  return {
    key: master.key,
    name: master.meta.name,
    status: master.meta.status ?? "stable",
    ...(master.meta.description ? { description: master.meta.description } : {}),
    variants: parsed ? effectiveVariants(master, parsed) : (master.meta.variants ?? {}),
    slots: parsed?.slots ?? [],
    usage: c.usage,
    tokenUses: parsed ? componentTokens(parsed, input.variables, index, ctx) : [],
    ...(deprecated ? { deprecated } : {}),
    warnings: c.warnings,
  };
}

const plural = (n: number, noun: string) => `${n} more ${noun}${n === 1 ? "" : "s"}`;

/**
 * The design system as the agent reads it: collections, tokens with their
 * per-mode values, and components with the tokens their CSS uses (resolved
 * under the chosen mode context). Pure: the caller hands in a snapshot.
 * Output order is deterministic: collections as declared, variables in
 * document order inside each, components by key.
 */
export function buildDesignSystem(input: DesignSystemInput, args: DesignSystemArgs = {}): DesignSystemResult {
  const index = buildVariableIndex(input.variables, input.collections);
  const allCollections = [...index.collections.values()];
  const scope = resolveScope(allCollections, input.savedScopes, args.scope);
  const modeArg = readModeArg(args.mode, allCollections);
  const modeContext = completeModeContext(allCollections, { ...input.modeContext, ...modeArg.picks });
  const hints = [...scope.hints, ...modeArg.hints];

  // An explicit mode pick narrows the listed values of its collection.
  const modeFilters = new Map(scope.modes);
  for (const [cid, modeId] of Object.entries(modeArg.picks)) modeFilters.set(cid, new Set([modeId]));

  const sections = new Set<DesignSystemSection>(args.include && args.include.length > 0 ? args.include : DEFAULT_SECTIONS);
  const limit = clampLimit(args.limit);
  let truncated = false;

  const shownCollections = allCollections.filter((c) => !scope.collectionIds || scope.collectionIds.has(c.id));
  const collections: DesignSystemCollection[] = shownCollections.map((c) => ({
    id: c.id,
    name: c.name,
    tier: tierOf(c, input.variables, index),
    modes: c.modes,
    defaultModeId: c.defaultModeId,
  }));

  const result: DesignSystemResult = {
    schema: 1,
    scope: { saved: scope.saved?.name ?? null, applied: scope.applied },
    modeContext,
    collections,
    truncated: false,
  };

  if (sections.has("tokens")) {
    const matching: DesignSystemToken[] = [];
    for (const collection of shownCollections) {
      for (const v of input.variables) {
        if (collectionIdOf(v) !== collection.id || !hasTokenScope(v, scope) || !matchesNames(v, scope)) continue;
        matching.push(describeToken(v, collection, modeContext, modeFilters.get(collection.id), input, index, allCollections));
      }
    }
    result.tokens = matching.slice(0, limit);
    if (matching.length > limit) {
      truncated = true;
      hints.push(`${plural(matching.length - limit, "token")} not shown (limit ${limit}). Narrow the scope or raise limit.`);
    }
    if (matching.length === 0 && scope.hints.length === 0) {
      const culprit = emptiedBy(input.variables, [
        ["scope.collections", scope.applied.collections, (v) => !scope.collectionIds || scope.collectionIds.has(collectionIdOf(v))],
        ["scope.tokenScopes", scope.applied.tokenScopes, (v) => hasTokenScope(v, scope)],
        ["scope.names", scope.applied.names, (v) => matchesNames(v, scope)],
      ]);
      hints.push(
        input.variables.length === 0
          ? "The document has no variables yet."
          : `No token remains after the filter ${culprit ?? "scope"}.`,
      );
    }
  }

  if (sections.has("components")) {
    const matching = input.components
      .filter((c) => keepKey(c, scope) && keepStatus(c, scope))
      .sort((a, b) => (a.master.key < b.master.key ? -1 : a.master.key > b.master.key ? 1 : 0));
    const emptied =
      matching.length === 0
        ? emptiedBy(input.components, [
            ["scope.components", scope.applied.components, (c) => keepKey(c, scope)],
            ["scope.componentStatus", scope.applied.componentStatus, (c) => keepStatus(c, scope)],
          ])
        : null;
    if (emptied) hints.push(`No component remains after the filter ${emptied}.`);
    result.components = matching.slice(0, limit).map((c) => describeComponent(c, input, index, modeContext));
    if (matching.length > limit) {
      truncated = true;
      hints.push(`${plural(matching.length - limit, "component")} not shown (limit ${limit}). Narrow the scope or raise limit.`);
    }
  }

  if (sections.has("lint")) {
    const rules = input.lintRules ?? [];
    result.lint = { rules, available: rules.length > 0 };
  }

  result.truncated = truncated;
  if (hints.length > 0) result.hint = hints.join(" ");
  return result;
}
