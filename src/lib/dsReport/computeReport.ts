import type { EmbedNode, FlatSceneNode } from "@/types/scene";
import { getVariableCssName } from "@/types/variable";
import { LINT_RULE_IDS, runDesignLint, type LintRuleId } from "@/lib/designLint";
import { parseColor } from "@/lib/designLint/colorMath";
import { paintTargets } from "@/lib/designLint/rules/tokenRules";
import { strokeIsDrawn } from "@/lib/designLint/shared";
import { countRegionsByKey } from "@/lib/embedComponents";
import { NUMBER_BINDING_KEYS, NUMBER_BINDING_SPECS, isKeyActive, readNumberField } from "@/lib/variables";
import {
  USAGE_BUDGET_MS,
  USAGE_MAX_EMBEDS,
  USAGE_MAX_EMBED_CHARS,
  USAGE_MAX_NODES,
  USAGE_MAX_UNUSED_LISTED,
  USAGE_REPORT_SCHEMA_VERSION,
  type LibraryUsage,
  type UsageInput,
  type UsageOptions,
  type UsageReport,
} from "./types";

const bump = (map: Record<string, number>, key: string, by = 1) => {
  map[key] = (map[key] ?? 0) + by;
};

const VAR_REF = /var\(\s*(--[\w-]+)/g;
const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
const STYLE_ATTR = /\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const COLOR_LITERAL = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|\brgba?\(|\bhsla?\(/gi;
const DETACHED_STYLE = /<style\b[^>]*\sdata-d-style=(["'])([^"']+)\1/gi;

/** The key of a detach scope `<key>-<n>`. */
function detachedKey(scope: string): string {
  return scope.replace(/-\d+$/, "");
}

/** Bindable and bound properties of one node, as counts. */
function countNodeTokens(
  node: FlatSceneNode,
  isLibraryVariable: (id: string) => boolean,
  out: { bindable: number; bound: number; boundToLibrary: number; use: Record<string, number> },
): void {
  const count = (variableId: string) => {
    out.bindable++;
    out.bound++;
    if (isLibraryVariable(variableId)) {
      out.boundToLibrary++;
      bump(out.use, variableId);
    }
  };
  if (!node.isMask) {
    const drawsStroke = strokeIsDrawn(node);
    for (const { slot, paint } of paintTargets(node)) {
      if (paint.type !== "solid" || paint.styleId) continue;
      if (slot === "stroke" && !drawsStroke) continue;
      if (paint.colorBinding) {
        count(paint.colorBinding.variableId);
        continue;
      }
      const color = parseColor(paint.color);
      if (color && color.a > 0) out.bindable++;
    }
  }
  const layoutOn = !!(node as { layout?: { autoLayout?: boolean } }).layout?.autoLayout;
  for (const key of NUMBER_BINDING_KEYS) {
    const binding = node.numberBindings?.[key];
    if (binding) {
      count(binding.variableId);
      continue;
    }
    // Sizes follow the layout, so a literal width or height is not a miss.
    if (key === "width" || key === "height") continue;
    if (NUMBER_BINDING_SPECS[key].where === "layout" && !layoutOn) continue;
    if (!isKeyActive(node, key)) continue;
    if (key === "strokeWidth" && !strokeIsDrawn(node)) continue;
    const value = readNumberField(node, key);
    if (value === undefined || value === 0 || (key === "opacity" && value === 1)) continue;
    out.bindable++;
  }
}

/**
 * Per-document adoption numbers. Pure and counts-only: nothing but ids and
 * keys of library items leaves a `use` map, so the result is safe to upload
 * later. Bounded by node and embed caps, an embed size cap and a wall-clock
 * budget; `truncated` says when any of them stopped the scan.
 */
export function computeUsageReport(input: UsageInput, opts: UsageOptions = {}): UsageReport {
  const maxNodes = opts.maxNodes ?? USAGE_MAX_NODES;
  const maxEmbeds = opts.maxEmbeds ?? USAGE_MAX_EMBEDS;
  const maxChars = opts.maxEmbedChars ?? USAGE_MAX_EMBED_CHARS;
  const now = opts.now ?? Date.now;
  const deadline = now() + (opts.budgetMs ?? USAGE_BUDGET_MS);
  let truncated = false;

  const libraryOf = new Map<string, string>();
  const byCssName = new Map<string, string>();
  for (const v of input.variables) {
    if (v.libraryId) libraryOf.set(v.id, v.libraryId);
    const css = getVariableCssName(v);
    if (!byCssName.has(css)) byCssName.set(css, v.id);
  }
  const isLibraryVariable = (id: string) => libraryOf.has(id);

  const libraryKeys = new Map<string, string>(); // component key -> library id
  for (const [key, master] of input.registry) {
    if (master.meta.library) libraryKeys.set(key, master.meta.library.id);
  }

  const tokens = { bindable: 0, bound: 0, boundToLibrary: 0, use: {} as Record<string, number> };
  const embedCss = { varRefs: 0, literals: 0 };
  const components = {
    instances: 0,
    libraryInstances: 0,
    detached: 0,
    use: {} as Record<string, number>,
    detachedByKey: {} as Record<string, number>,
  };
  let nodes = 0;
  let embedsSeen = 0;
  const embedNodes: EmbedNode[] = [];

  scan: for (const page of input.pages) {
    for (const id in page.nodesById) {
      if (nodes >= maxNodes || ((nodes & 255) === 255 && now() > deadline)) {
        truncated = true;
        break scan;
      }
      const node = page.nodesById[id];
      if (node.visible === false || node.enabled === false) continue;
      nodes++;
      if (node.type === "embed") embedNodes.push(node as unknown as EmbedNode);
      else countNodeTokens(node, isLibraryVariable, tokens);
    }
  }

  for (const embed of embedNodes) {
    const html = embed.htmlContent;
    if (embed.component || !html) continue;
    if (embedsSeen >= maxEmbeds || now() > deadline) {
      truncated = true;
      break;
    }
    embedsSeen++;
    const text = html.length > maxChars ? html.slice(0, maxChars) : html;
    if (text.length < html.length) truncated = true;

    const css: string[] = [];
    for (const m of text.matchAll(STYLE_BLOCK)) css.push(m[1]);
    for (const m of text.matchAll(STYLE_ATTR)) css.push(m[1] ?? m[2] ?? "");
    for (const block of css) {
      for (const m of block.matchAll(VAR_REF)) {
        const variableId = byCssName.get(m[1]);
        if (!variableId) continue;
        embedCss.varRefs++;
        if (libraryOf.has(variableId)) bump(tokens.use, variableId);
      }
      embedCss.literals += (block.replace(/var\([^)]*\)/g, "").match(COLOR_LITERAL) ?? []).length;
    }

    for (const [key, regions] of countRegionsByKey(text)) {
      if (!input.registry.has(key)) continue;
      components.instances += regions;
      if (libraryKeys.has(key)) {
        components.libraryInstances += regions;
        bump(components.use, key, regions);
      }
    }
    for (const m of text.matchAll(DETACHED_STYLE)) {
      components.detached++;
      const key = detachedKey(m[2]);
      if (libraryKeys.has(key)) bump(components.detachedByKey, key);
    }
  }

  // Embed CSS var() uses of library tokens count as use above; bindings were counted per node.
  const libraries = new Map<string, LibraryUsage>();
  const pinOf = new Map((input.pins ?? []).map((p) => [p.id, p]));
  const libraryEntry = (libraryId: string): LibraryUsage => {
    let entry = libraries.get(libraryId);
    if (!entry) {
      entry = {
        libraryId,
        version: pinOf.get(libraryId)?.version ?? null,
        reportUsage: pinOf.get(libraryId)?.reportUsage === true,
        tokens: { total: 0, used: 0, unused: 0 },
        components: { total: 0, used: 0, unused: 0 },
        unusedTokenIds: [],
        unusedComponentKeys: [],
      };
      libraries.set(libraryId, entry);
    }
    return entry;
  };
  for (const id of pinOf.keys()) libraryEntry(id);
  for (const [variableId, libraryId] of libraryOf) {
    const entry = libraryEntry(libraryId);
    entry.tokens.total++;
    if (tokens.use[variableId]) entry.tokens.used++;
    else {
      entry.tokens.unused++;
      if (entry.unusedTokenIds.length < USAGE_MAX_UNUSED_LISTED) entry.unusedTokenIds.push(variableId);
    }
  }
  for (const [key, libraryId] of libraryKeys) {
    const entry = libraryEntry(libraryId);
    entry.version ??= input.registry.get(key)?.meta.library?.version ?? null;
    entry.components.total++;
    if (components.use[key]) entry.components.used++;
    else {
      entry.components.unused++;
      if (entry.unusedComponentKeys.length < USAGE_MAX_UNUSED_LISTED) entry.unusedComponentKeys.push(key);
    }
  }

  let lint: Record<LintRuleId, number> | null = null;
  if (input.lint) {
    const remaining = Math.max(0, deadline - now());
    const result = runDesignLint(input.lint, {
      countsOnly: true,
      maxNodes,
      maxEmbeds,
      budgetMs: remaining,
      now,
    });
    lint = Object.fromEntries(LINT_RULE_IDS.map((r) => [r, result.summary.byRule[r] ?? 0])) as Record<LintRuleId, number>;
    if (result.scanTruncated) truncated = true;
  }

  return {
    schemaVersion: USAGE_REPORT_SCHEMA_VERSION,
    nodes,
    embeds: embedsSeen,
    tokens: {
      bindable: tokens.bindable,
      bound: tokens.bound,
      boundToLibrary: tokens.boundToLibrary,
      literal: tokens.bindable - tokens.bound,
      use: tokens.use,
      embed: embedCss,
    },
    components,
    lint,
    libraries: [...libraries.values()].sort((a, b) => a.libraryId.localeCompare(b.libraryId)),
    truncated,
  };
}
