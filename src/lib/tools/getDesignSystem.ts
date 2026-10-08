import { useVariableStore } from "@/store/variableStore";
import { useThemeStore } from "@/store/themeStore";
import { useDesignSystemScopeStore } from "@/store/designSystemScopeStore";
import { duplicateKeyWarnings, selectComponentRegistry } from "@/store/componentRegistry";
import { countUsage } from "@/store/componentOps";
import { buildDesignSystem } from "@/lib/designSystem";
import type { ComponentInput, DesignSystemArgs, DesignSystemSection } from "@/lib/designSystem";
import type { VariableScope } from "@/types/variable";
import { LINT_RULE_CATALOG, buildLintInput, runDesignLint } from "@/lib/designLint";
import type { ToolHandler } from "../toolRegistry";

const SECTIONS: readonly DesignSystemSection[] = ["tokens", "components", "lint"];
// The counts scan is a side dish of get_design_system, so its budget is far
// smaller than lint_design's own (LINT_BUDGET_MS).
const LINT_COUNT_BUDGET_MS = 2_000;
const LINT_COUNT_MAX_NODES = 20_000;
const LINT_COUNT_MAX_EMBEDS = 50;
const STATUSES = ["draft", "stable", "deprecated"] as const;

function stringList(x: unknown): string[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const out = x.filter((s): s is string => typeof s === "string");
  return out.length > 0 ? out : undefined;
}

/** Tolerant read of the tool arguments: wrong-typed fields are dropped, not fatal. */
function readArgs(args: Record<string, unknown>): DesignSystemArgs {
  const out: DesignSystemArgs = {};
  const scope = args.scope;
  if (scope && typeof scope === "object" && !Array.isArray(scope)) {
    const s = scope as Record<string, unknown>;
    const status = stringList(s.componentStatus)?.filter((v): v is (typeof STATUSES)[number] =>
      (STATUSES as readonly string[]).includes(v),
    );
    out.scope = {
      ...(typeof s.saved === "string" && s.saved.trim() !== "" ? { saved: s.saved } : {}),
      ...(stringList(s.collections) ? { collections: stringList(s.collections) } : {}),
      ...(stringList(s.components) ? { components: stringList(s.components) } : {}),
      ...(status && status.length > 0 ? { componentStatus: status } : {}),
      ...(stringList(s.tokenScopes) ? { tokenScopes: stringList(s.tokenScopes) as VariableScope[] } : {}),
      ...(stringList(s.names) ? { names: stringList(s.names) } : {}),
    };
  }
  const mode = args.mode;
  if (typeof mode === "string") out.mode = mode;
  else if (mode && typeof mode === "object" && !Array.isArray(mode)) {
    const map: Record<string, string> = {};
    for (const [k, v] of Object.entries(mode)) if (typeof v === "string") map[k] = v;
    out.mode = map;
  }
  const include = stringList(args.include)?.filter((v): v is DesignSystemSection =>
    (SECTIONS as readonly string[]).includes(v),
  );
  if (include && include.length > 0) out.include = include;
  if (typeof args.limit === "number") out.limit = args.limit;
  return out;
}

/** Read the design system: tokens, components, saved scopes. Read-only. */
export const getDesignSystem: ToolHandler = async (args) => {
  const { variables, collections } = useVariableStore.getState();
  const registry = selectComponentRegistry();
  const usage = countUsage(registry);
  const components: ComponentInput[] = [...registry.values()].map((master) => ({
    master,
    usage: usage.get(master.key) ?? { instances: 0, embeds: 0 },
    warnings: duplicateKeyWarnings(master.key),
  }));

  const parsed = readArgs(args ?? {});
  const result = buildDesignSystem(
    {
      variables,
      collections,
      modeContext: useThemeStore.getState().modeContext,
      components,
      savedScopes: useDesignSystemScopeStore.getState().scopes,
      lintRules: LINT_RULE_CATALOG.map((r) => ({
        id: r.id,
        severity: r.defaultSeverity,
        description: r.description,
        autoFix: r.autoFix,
      })),
    },
    parsed,
  );
  // Counting runs the whole lint engine, so it happens only when the caller
  // asked for the lint section by name (the default sections never pay for it).
  if (result.lint && parsed.include?.includes("lint")) {
    const lint = runDesignLint(buildLintInput(), {
      modes: [result.modeContext],
      limit: 1,
      maxNodes: LINT_COUNT_MAX_NODES,
      maxEmbeds: LINT_COUNT_MAX_EMBEDS,
      budgetMs: LINT_COUNT_BUDGET_MS,
    });
    result.lint.counts = lint.summary.byRule;
    if (lint.scanTruncated) result.lint.countsTruncated = true;
  }
  return JSON.stringify(result);
};
