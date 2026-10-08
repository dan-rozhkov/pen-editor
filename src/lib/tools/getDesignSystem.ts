import { useVariableStore } from "@/store/variableStore";
import { useThemeStore } from "@/store/themeStore";
import { useDesignSystemScopeStore } from "@/store/designSystemScopeStore";
import { allPageNodes, duplicateKeyWarnings, selectComponentRegistry } from "@/store/componentRegistry";
import { buildDesignSystem } from "@/lib/designSystem";
import type { ComponentInput, DesignSystemArgs, DesignSystemSection } from "@/lib/designSystem";
import type { EmbedNode } from "@/types/scene";
import type { VariableScope } from "@/types/variable";
import type { ToolHandler } from "../toolRegistry";

// `library` is accepted but optional: the backend schema may not offer it, and
// the builder ignores a section it has no data for.
const SECTIONS: readonly DesignSystemSection[] = ["tokens", "components", "lint", "library"];
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

const REGION_RE = /<[a-zA-Z][^>]*?\sdata-c=(["'])([^"']+)\1/g;

/** Per component key: regions placed (`instances`) and embeds holding at least one (`embeds`). Masters are excluded. */
function countUsage(keys: Iterable<string>): Map<string, { instances: number; embeds: number }> {
  const usage = new Map<string, { instances: number; embeds: number }>();
  for (const key of keys) usage.set(key, { instances: 0, embeds: 0 });
  for (const page of allPageNodes()) {
    for (const id in page.nodesById) {
      const node = page.nodesById[id];
      if (node.type !== "embed") continue;
      const embed = node as unknown as EmbedNode;
      if (embed.component || !embed.htmlContent || !embed.htmlContent.includes("data-c=")) continue;
      const seen = new Set<string>();
      for (const m of embed.htmlContent.matchAll(REGION_RE)) {
        const entry = usage.get(m[2]);
        if (!entry) continue;
        entry.instances += 1;
        seen.add(m[2]);
      }
      for (const key of seen) usage.get(key)!.embeds += 1;
    }
  }
  return usage;
}

/** Read the design system: tokens, components, saved scopes. Read-only. */
export const getDesignSystem: ToolHandler = async (args) => {
  const { variables, collections } = useVariableStore.getState();
  const registry = selectComponentRegistry();
  const usage = countUsage(registry.keys());
  const components: ComponentInput[] = [...registry.values()].map((master) => ({
    master,
    usage: usage.get(master.key) ?? { instances: 0, embeds: 0 },
    warnings: duplicateKeyWarnings(master.key),
  }));

  const result = buildDesignSystem(
    {
      variables,
      collections,
      modeContext: useThemeStore.getState().modeContext,
      components,
      savedScopes: useDesignSystemScopeStore.getState().scopes,
    },
    readArgs(args ?? {}),
  );
  return JSON.stringify(result);
};
