import type { EmbedNode, FlatSceneNode } from "@/types/scene";
import { getVariableCssName } from "@/types/variable";
import { LINT_RULE_IDS, runDesignLint, type LintRuleId } from "@/lib/designLint";
import { parseColor } from "@/lib/designLint/colorMath";
import { isColorProperty, parseDeclarations, stripVarCalls } from "@/lib/designLint/embedDom";
import { parseCss, type CssNode } from "@/lib/embedComponents/css";
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
const STYLE_BLOCK = /<style\b([^>]*)>([\s\S]*?)<\/style>/gi;
const MANAGED_STYLE = /\sdata-(?:c|d)-style\b/i;
const STYLE_ATTR = /\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
/** Elements that were detached from a component: one `data-d="<key>-<n>"` each, like the lint's drift rule. */
const DETACHED = /<[a-z][^>]*?\sdata-d=(["'])([^"']+)\1/gi;
const COLOR_LITERAL =
  /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix|color)\((?:[^()]|\([^()]*\))*\)/gi;
/** Common named colors; `transparent`, `currentcolor` and `inherit` are not literals. */
const NAMED_COLORS = new Set(
  "white black red green blue gray grey yellow orange purple pink brown cyan magenta navy teal silver gold maroon olive lime aqua fuchsia indigo violet coral crimson tomato salmon khaki ivory beige lavender plum orchid tan turquoise".split(" "),
);

function walkDecls(nodes: CssNode[], visit: (property: string, value: string) => void): void {
  for (const node of nodes) {
    if (node.kind === "rule") for (const d of parseDeclarations(node.body)) visit(d.property, d.value);
    else if (node.kind === "group") walkDecls(node.children, visit);
  }
}

function countColorLiterals(property: string, value: string): number {
  if (!isColorProperty(property)) return 0;
  const bare = stripVarCalls(value);
  let n = (bare.match(COLOR_LITERAL) ?? []).length;
  const rest = bare.replace(COLOR_LITERAL, " ");
  for (const word of rest.toLowerCase().split(/[^a-z]+/)) if (NAMED_COLORS.has(word)) n++;
  return n;
}

/** The key of a detach scope `<key>-<n>`. */
function detachedKey(scope: string): string {
  return scope.replace(/-\d+$/, "");
}

/** Bindable and bound properties of one node, as counts. */
function countNodeTokens(
  node: FlatSceneNode,
  isLibraryVariable: (id: string) => boolean,
  out: { bindable: number; bound: number; boundToLibrary: number; styled: number; use: Record<string, number> },
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
      if (paint.type !== "solid") continue;
      if (slot === "stroke" && !drawsStroke) continue;
      if (paint.styleId) {
        out.bindable++;
        out.bound++;
        out.styled++;
        continue;
      }
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
  const collided = new Set<string>();
  for (const v of input.variables) {
    if (v.libraryId) libraryOf.set(v.id, v.libraryId);
    const css = getVariableCssName(v);
    const prior = byCssName.get(css);
    if (prior === undefined) byCssName.set(css, v.id);
    else {
      collided.add(css);
      if (!libraryOf.has(prior) && v.libraryId) byCssName.set(css, v.id);
    }
  }
  const isLibraryVariable = (id: string) => libraryOf.has(id);

  const libraryKeys = new Map<string, string>(); // component key -> library id
  for (const [key, master] of input.registry) {
    if (master.meta.library) libraryKeys.set(key, master.meta.library.id);
  }

  const tokens = { bindable: 0, bound: 0, boundToLibrary: 0, styled: 0, use: {} as Record<string, number> };
  const embedCss = { varRefs: 0, unknownVarRefs: 0, literals: 0 };
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
    const stack = [...page.rootIds].reverse();
    while (stack.length > 0) {
      const id = stack.pop() as string;
      const node = page.nodesById[id];
      // A hidden or disabled node hides its whole subtree.
      if (!node || node.visible === false || node.enabled === false) continue;
      if (nodes >= maxNodes || ((nodes & 255) === 255 && now() > deadline)) {
        truncated = true;
        break scan;
      }
      nodes++;
      const kids = page.childrenById[id];
      if (kids) for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
      if (node.type === "embed") embedNodes.push(node as unknown as EmbedNode);
      else countNodeTokens(node, isLibraryVariable, tokens);
    }
  }

  for (const embed of embedNodes) {
    const html = embed.htmlContent;
    if (!html) continue;
    if (embedsSeen >= maxEmbeds || now() > deadline) {
      truncated = true;
      break;
    }
    embedsSeen++;
    const text = html.length > maxChars ? html.slice(0, maxChars) : html;
    if (text.length < html.length) truncated = true;

    // Own CSS only: managed copies of a master's CSS count once, on the master.
    const declared = new Set<string>();
    const decls: Array<[string, string]> = [];
    const collect = (property: string, value: string) => {
      if (property.startsWith("--")) declared.add(property);
      decls.push([property, value]);
    };
    for (const m of text.matchAll(STYLE_BLOCK)) {
      if (!MANAGED_STYLE.test(` ${m[1]}`)) walkDecls(parseCss(m[2]), collect);
    }
    for (const m of text.matchAll(STYLE_ATTR)) {
      for (const d of parseDeclarations(m[1] ?? m[2] ?? "")) collect(d.property, d.value);
    }
    for (const [property, value] of decls) {
      for (const m of value.matchAll(VAR_REF)) {
        const variableId = byCssName.get(m[1]);
        if (variableId) {
          embedCss.varRefs++;
          if (libraryOf.has(variableId)) bump(tokens.use, variableId);
        } else if (!declared.has(m[1])) embedCss.unknownVarRefs++;
      }
      embedCss.literals += countColorLiterals(property, value);
    }

    // A master is a definition: its instances and copies are not uses.
    if (embed.component) continue;
    for (const [key, regions] of countRegionsByKey(text)) {
      if (!input.registry.has(key)) continue;
      components.instances += regions;
      if (libraryKeys.has(key)) {
        components.libraryInstances += regions;
        bump(components.use, key, regions);
      }
    }
    for (const m of text.matchAll(DETACHED)) {
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
      styled: tokens.styled,
      literal: tokens.bindable - tokens.bound,
      use: tokens.use,
      embed: embedCss,
      cssNameCollisions: collided.size,
    },
    components,
    lint,
    libraries: [...libraries.values()].sort((a, b) => a.libraryId.localeCompare(b.libraryId)),
    truncated,
  };
}
