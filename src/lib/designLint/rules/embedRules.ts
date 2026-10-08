import type { ModeContext, Variable, VariableScope } from "@/types/variable";
import { getVariableCssName } from "@/types/variable";
import { parseEmbedHtml } from "@/lib/embedHtmlDocument";
import { hasStaleRegions, listRegionKeys } from "@/lib/embedComponents";
import type { ComponentRegistry } from "@/lib/embedComponents";
import { formatVariableRef } from "@/lib/tools/variableToolUtils";
import {
  colorsEqual,
  compositeOver,
  contrastRatio,
  formatRatio,
  isLargeText,
  oklabDistance,
  parseColor,
  requiredRatio,
  toHex,
  type Rgba,
} from "../colorMath";
import { findingId, type LintContext } from "../context";
import {
  LimitedCascade,
  collectStyleRules,
  colorLiterals,
  elementPath,
  inManagedZone,
  parseInlineStyle,
  pxLiteral,
  type StyleRule,
} from "../embedDom";
import type { Finding, LintEmbed, LintRuleId } from "../types";
import { colorScopeOk, numberScopeOk, preferSemantic } from "./tokenRules";

export const EMBED_CONTRAST_MAX_CHARS = 200_000;
export const EMBED_CONTRAST_MAX_TEXT_ELEMENTS = 2000;
const EPS = 1e-9;
const NEAR_COLOR_DISTANCE = 0.04;

interface ParsedEmbed {
  embed: LintEmbed;
  doc: Document;
}

function parsedEmbeds(lc: LintContext): ParsedEmbed[] {
  const out: ParsedEmbed[] = [];
  for (const embed of lc.embeds) {
    if (!embed.html) continue;
    const doc = parseEmbedHtml(embed.html);
    if (doc) out.push({ embed, doc });
  }
  return out;
}

function baseModesFor(lc: LintContext, embed: LintEmbed, base: ModeContext): ModeContext {
  return embed.pageId === lc.input.pageId ? lc.effectiveModes(embed.nodeId, base) : base;
}

function colorScopeFor(property: string): VariableScope {
  if (property === "color") return "text";
  if (property === "fill") return "fill";
  if (property === "stroke" || property.startsWith("border") || property.startsWith("outline")) return "stroke";
  return "fill";
}

// ---------------------------------------------------------------------------
// embed-literal
// ---------------------------------------------------------------------------

export function runEmbedLiteralRule(lc: LintContext, parsed: ParsedEmbed[]): void {
  // Without color tokens every literal would be "wrong"; there is nothing to point at.
  if (!lc.input.variables.some((v) => v.type === "color" && !v.deprecated)) return;
  const cssName = (v: Variable) => getVariableCssName(v);
  for (const { embed, doc } of parsed) {
    if (lc.expired()) return;
    const ctx = baseModesFor(lc, embed, lc.contexts[0]);
    const colors = lc.colorTokens(ctx);
    const numbers = lc.numberTokens(ctx);
    const seen = new Set<string>();

    const report = (path: string, property: string, value: string) => {
      for (const literal of colorLiterals(property, value)) {
        const color = parseColor(literal);
        if (!color) continue;
        const id = findingId("embed-literal", embed.nodeId, path, property, literal);
        if (seen.has(id)) continue;
        seen.add(id);
        const scoped = colors.filter((t) => colorScopeOk(t.variable, colorScopeFor(property)));
        const exact = preferSemantic(scoped.filter((t) => colorsEqual(t.color, color)));
        const where = embed.masterKey ? `component \`${embed.masterKey}\`` : "embed";
        if (exact.length > 0) {
          const best = exact[0].variable;
          lc.add({
            id,
            rule: "embed-literal",
            severity: "warning",
            nodeId: embed.nodeId,
            pageId: embed.pageId,
            embedPath: path,
            message: `${property}: ${literal} in ${where} equals token ${formatVariableRef(lc.input.variables, lc.input.collections, best)}; use var(${cssName(best)}).`,
            fix: { kind: "embed-replace", nodeId: embed.nodeId, property, from: literal, to: `var(${cssName(best)})` },
          });
        } else {
          const near = preferSemantic(scoped).find((t) => oklabDistance(t.color, color) < NEAR_COLOR_DISTANCE);
          lc.add({
            id,
            rule: "embed-literal",
            severity: "info",
            nodeId: embed.nodeId,
            pageId: embed.pageId,
            embedPath: path,
            message: `${property}: ${literal} in ${where} is a literal color${near ? `; close to token ${formatVariableRef(lc.input.variables, lc.input.collections, near.variable)}` : ""}.`,
          });
        }
      }
      const px = pxLiteral(property, value);
      if (!px) return;
      const scopeList: VariableScope[] = px.scope === "spacing" ? ["spacing", "gap"] : [px.scope];
      const match = preferSemantic(
        numbers.filter((t) => numberScopeOk(t.variable, scopeList) && Math.abs(t.value - px.px) < 1e-6),
      )[0];
      if (!match) return;
      const id = findingId("embed-literal", embed.nodeId, path, property, value);
      if (seen.has(id)) return;
      seen.add(id);
      lc.add({
        id,
        rule: "embed-literal",
        severity: "warning",
        nodeId: embed.nodeId,
        pageId: embed.pageId,
        embedPath: path,
        message: `${property}: ${value} equals token ${formatVariableRef(lc.input.variables, lc.input.collections, match.variable)}; use var(${cssName(match.variable)}).`,
        fix: {
          kind: "embed-replace",
          nodeId: embed.nodeId,
          property,
          from: value.trim(),
          to: `var(${cssName(match.variable)})`,
        },
      });
    };

    for (const el of Array.from(doc.querySelectorAll("[style]"))) {
      if (inManagedZone(el, embed.masterKey)) continue;
      const path = elementPath(el);
      for (const d of parseInlineStyle(el)) report(path, d.property, d.value);
    }
    for (const rule of collectStyleRules(doc)) {
      for (const d of rule.decls) report(rule.label, d.property, d.value);
    }
  }
}

// ---------------------------------------------------------------------------
// embed contrast
// ---------------------------------------------------------------------------

const TEXT_SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "TITLE", "META", "LINK"]);
const BOLD_TAGS = new Set(["B", "STRONG", "TH", "H1", "H2", "H3", "H4", "H5", "H6"]);

function hasOwnText(el: Element): boolean {
  return Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? "").trim().length > 0);
}

/** Resolves CSS values to colors for one embed under one mode context. */
class EmbedColors {
  private readonly lc: LintContext;
  private readonly cascade: LimitedCascade;
  private readonly ctx: ModeContext;

  constructor(lc: LintContext, cascade: LimitedCascade, ctx: ModeContext) {
    this.lc = lc;
    this.cascade = cascade;
    this.ctx = ctx;
  }

  private customProperty(el: Element | null, name: string): string | undefined {
    for (let cur = el; cur; cur = cur.parentElement) {
      const v = this.cascade.declared(cur).get(name);
      if (v !== undefined) return v;
    }
    return undefined;
  }

  /** A value as a color, resolving `var()` through the embed's own custom properties, then the document tokens. */
  color(value: string, el: Element, depth = 0): Rgba | null {
    if (depth > 6) return null;
    const v = value.trim();
    const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.*))?\)$/is.exec(v);
    if (!m) return parseColor(v);
    const own = this.customProperty(el, m[1]);
    if (own !== undefined) return this.color(own, el, depth + 1);
    const variable = this.lc.input.variables.find((x) => x.type === "color" && getVariableCssName(x) === m[1]);
    if (variable) {
      const resolved = this.lc.resolve(variable.id, this.ctx);
      if (resolved !== undefined) return parseColor(resolved);
    }
    return m[2] !== undefined ? this.color(m[2], el, depth + 1) : null;
  }

  /** `color` of the element: declared on it or an ancestor, black when nobody declares one. */
  foreground(el: Element): Rgba | null {
    for (let cur: Element | null = el; cur; cur = cur.parentElement) {
      const value = this.cascade.declared(cur).get("color");
      if (value === undefined) continue;
      if (/^(inherit|currentcolor|unset|initial)$/i.test(value.trim())) continue;
      return this.color(value, cur);
    }
    return { r: 0, g: 0, b: 0, a: 1 };
  }

  /** The opaque background behind the element, null when it cannot be known. */
  background(el: Element): Rgba | null {
    const layers: Rgba[] = [];
    for (let cur: Element | null = el; cur; cur = cur.parentElement) {
      const decls = this.cascade.declared(cur);
      const bg = decls.get("background-color") ?? decls.get("background");
      const image = decls.get("background-image");
      if (image !== undefined && !/^none$/i.test(image.trim())) return null;
      if (bg === undefined) continue;
      if (/url\(|gradient\(/i.test(bg)) return null;
      if (/^(inherit|unset|initial)$/i.test(bg.trim())) continue;
      const color = this.color(bg, cur);
      if (!color) return null;
      layers.push(color);
      if (color.a >= 0.999) {
        let out = color;
        for (let i = layers.length - 2; i >= 0; i--) out = compositeOver(layers[i], out);
        return out;
      }
    }
    return null;
  }

  fontSize(el: Element): number | null {
    const chain: Element[] = [];
    for (let cur: Element | null = el; cur; cur = cur.parentElement) chain.unshift(cur);
    let size = 16;
    for (const node of chain) {
      const raw = this.cascade.declared(node).get("font-size")?.trim().toLowerCase();
      if (!raw) continue;
      const m = /^(\d+(?:\.\d+)?)(px|pt|rem|em|%)$/.exec(raw);
      if (!m) return null;
      const n = Number(m[1]);
      size = m[2] === "px" ? n : m[2] === "pt" ? (n * 4) / 3 : m[2] === "rem" ? n * 16 : m[2] === "em" ? size * n : (size * n) / 100;
    }
    return size;
  }

  fontWeight(el: Element): string {
    for (let cur: Element | null = el; cur; cur = cur.parentElement) {
      const w = this.cascade.declared(cur).get("font-weight");
      if (w !== undefined) return w.trim().toLowerCase();
      if (BOLD_TAGS.has(cur.tagName)) return "700";
    }
    return "400";
  }
}

function isHiddenElement(el: Element, cascade: LimitedCascade): boolean {
  if (el.hasAttribute("hidden")) return true;
  const d = cascade.declared(el);
  return /^none$/i.test(d.get("display")?.trim() ?? "") || /^hidden$/i.test(d.get("visibility")?.trim() ?? "");
}

function hiddenOrSkipped(el: Element, cascade: LimitedCascade): boolean {
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    if (TEXT_SKIP.has(cur.tagName) || isHiddenElement(cur, cascade)) return true;
  }
  return false;
}

export function runEmbedContrastRule(lc: LintContext, parsed: ParsedEmbed[]): void {
  for (const { embed, doc } of parsed) {
    if (lc.expired()) return;
    if (embed.html.length > EMBED_CONTRAST_MAX_CHARS) {
      lc.embedsPartial++;
      continue;
    }
    const cascade = new LimitedCascade(collectStyleRules(doc));
    const elements = Array.from(doc.body.querySelectorAll("*")).filter(
      (el) => hasOwnText(el) && !inManagedZone(el, embed.masterKey) && !hiddenOrSkipped(el, cascade),
    );
    if (elements.length > EMBED_CONTRAST_MAX_TEXT_ELEMENTS) lc.embedsPartial++;
    const contexts = embed.html.includes("var(") ? lc.contexts : lc.contexts.slice(0, 1);
    const found: Finding[] = [];
    for (const base of contexts) {
      const colors = new EmbedColors(lc, cascade, baseModesFor(lc, embed, base));
      const mode = lc.label(base);
      for (const el of elements.slice(0, EMBED_CONTRAST_MAX_TEXT_ELEMENTS)) {
        const fg = colors.foreground(el);
        const bg = fg ? colors.background(el) : null;
        if (!fg || !bg) continue;
        const text = compositeOver(fg, bg);
        const ratio = contrastRatio(text, bg);
        const size = colors.fontSize(el);
        const large = size !== null && isLargeText(size, colors.fontWeight(el));
        const need = requiredRatio(large);
        if (ratio + EPS >= need) continue;
        const path = elementPath(el);
        found.push({
          id: findingId("contrast", embed.nodeId, "embed", path),
          rule: "contrast",
          severity: "error",
          nodeId: embed.nodeId,
          pageId: embed.pageId,
          embedPath: path,
          message: `Text in ${embed.masterKey ? `component \`${embed.masterKey}\`` : "embed"} at ${path} has contrast ${formatRatio(ratio, need)}:1 (${toHex(text)} on ${toHex(bg)}); ${large ? "large text" : "text"} needs ${need}:1.`,
          mode: mode || undefined,
        });
      }
    }
    lc.addPerMode(found);
  }
}

// ---------------------------------------------------------------------------
// deprecated-component, component-drift
// ---------------------------------------------------------------------------

export function runDeprecatedComponentRule(lc: LintContext, parsed: ParsedEmbed[]): void {
  for (const { embed } of parsed) {
    for (const key of listRegionKeys(embed.html)) {
      if (key === embed.masterKey) continue;
      const meta = lc.input.registry.get(key)?.meta;
      if (!meta || (meta.status !== "deprecated" && !meta.deprecated)) continue;
      const replacement = meta.deprecated?.replacedBy;
      lc.add({
        id: findingId("deprecated-component", embed.nodeId, key),
        rule: "deprecated-component",
        severity: "warning",
        nodeId: embed.nodeId,
        pageId: embed.pageId,
        message: `Embed uses deprecated component \`${key}\`${replacement ? `; replace it with \`${replacement}\`` : ""}.`,
        detail: meta.deprecated?.note,
      });
    }
  }
}

const DETACHED = /<[a-z][^>]*?\sdata-d=(["'])([^"']+)\1/gi;

function staleKeys(html: string, registry: ComponentRegistry, keys: string[]): string[] {
  return keys.filter((key) => {
    const master = registry.get(key);
    return !!master && hasStaleRegions(html, new Map([[key, master]]));
  });
}

export function runComponentDriftRule(lc: LintContext, parsed: ParsedEmbed[]): void {
  const { registry } = lc.input;
  const pageOf = new Map(lc.input.embeds.map((e) => [e.nodeId, e.pageId]));
  for (const { embed } of parsed) {
    const keys = listRegionKeys(embed.html).filter((k) => k !== embed.masterKey);
    for (const key of staleKeys(embed.html, registry, keys)) {
      lc.add({
        id: findingId("component-drift", embed.nodeId, "stale", key),
        rule: "component-drift",
        severity: "warning",
        nodeId: embed.nodeId,
        pageId: embed.pageId,
        message: `Component \`${key}\` in this embed is out of date with its master.`,
        fix: { kind: "reconcile-component", key, nodeId: embed.nodeId },
      });
    }
    for (const key of keys) {
      if (registry.has(key)) continue;
      lc.add({
        id: findingId("component-drift", embed.nodeId, "orphan", key),
        rule: "component-drift",
        severity: "warning",
        nodeId: embed.nodeId,
        pageId: embed.pageId,
        message: `Component \`${key}\` has no master; the region is plain HTML now.`,
      });
    }
    const scopes = new Set<string>();
    for (const m of embed.html.matchAll(DETACHED)) scopes.add(m[2]);
    for (const scope of scopes) {
      lc.add({
        id: findingId("component-drift", embed.nodeId, "detached", scope),
        rule: "component-drift",
        severity: "info",
        nodeId: embed.nodeId,
        pageId: embed.pageId,
        message: `Detached copy of component \`${scope.replace(/-\d+$/, "")}\` (${scope}); it no longer follows its master.`,
      });
    }
  }
  const inScope = new Set(lc.embeds.map((e) => e.nodeId));
  for (const [key, ids] of lc.input.duplicateMasters) {
    for (const nodeId of ids) {
      if (!inScope.has(nodeId)) continue;
      lc.add({
        id: findingId("component-drift", nodeId, "duplicate-master", key),
        rule: "component-drift",
        severity: "warning",
        nodeId,
        pageId: pageOf.get(nodeId) ?? lc.input.pageId,
        message: `Component \`${key}\` has more than one master; this copy is ignored. Delete the extra master.`,
      });
    }
  }
}

/** Runs the enabled embed rules over the embeds in scope (each embed is parsed once). */
export function runEmbedRules(lc: LintContext, enabled: ReadonlySet<LintRuleId>): void {
  const needsDom =
    enabled.has("embed-literal") ||
    enabled.has("contrast") ||
    enabled.has("deprecated-component") ||
    enabled.has("component-drift");
  if (!needsDom || lc.embeds.length === 0) return;
  const parsed = parsedEmbeds(lc);
  if (enabled.has("embed-literal")) runEmbedLiteralRule(lc, parsed);
  if (enabled.has("contrast")) runEmbedContrastRule(lc, parsed);
  if (enabled.has("deprecated-component")) runDeprecatedComponentRule(lc, parsed);
  if (enabled.has("component-drift")) runComponentDriftRule(lc, parsed);
}

export type { StyleRule };
