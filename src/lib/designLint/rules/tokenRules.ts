import type { FlatSceneNode, NumberBindingKey, Paint, SolidPaint } from "@/types/scene";
import type { ModeContext, Variable, VariableScope } from "@/types/variable";
import { getFills, getStrokes } from "@/utils/fillUtils";
import { NUMBER_BINDING_KEYS, NUMBER_BINDING_SPECS, isKeyActive, readNumberField } from "@/lib/variables";
import { formatVariableRef } from "@/lib/tools/variableToolUtils";
import { colorsEqual, oklabDistance, parseColor, toHex } from "../colorMath";
import { findingId, type ColorToken, type LintContext } from "../context";
import type { ColorSlot, Finding, LintFix, LintRuleId } from "../types";

/** Largest OKLab distance at which an unbound color still reads as "meant to be that token". */
const NEAR_COLOR_DISTANCE = 0.04;
/** Off-scale numbers: within this many px, or this fraction of the token, count as near. */
const NEAR_NUMBER_PX = 2;
const NEAR_NUMBER_RATIO = 0.25;
const MAX_REPLACEMENT_HOPS = 8;

export interface PaintTarget {
  slot: ColorSlot;
  paint: Paint;
  /** Absent for the legacy single fill / stroke fields. */
  paintId?: string;
}

/** The visible paints of a node that carry a color: fills, then strokes. */
export function paintTargets(node: FlatSceneNode): PaintTarget[] {
  const out: PaintTarget[] = [];
  const add = (slot: ColorSlot, paints: Paint[], stacked: boolean) => {
    for (const paint of paints) {
      if (paint.visible === false) continue;
      out.push({ slot, paint, paintId: stacked ? paint.id : undefined });
    }
  };
  add("fill", getFills(node), !!node.fills);
  add("stroke", getStrokes(node), !!node.strokes);
  return out;
}

function strokeIsDrawn(node: FlatSceneNode): boolean {
  if ((node.strokeWidth ?? 0) > 0) return true;
  const sides = node.strokeWidthPerSide;
  if (sides && [sides.top, sides.right, sides.bottom, sides.left].some((v) => (v ?? 0) > 0)) return true;
  return ((node as { pathStroke?: { thickness?: number } }).pathStroke?.thickness ?? 0) > 0;
}

function scopeFor(node: FlatSceneNode, slot: ColorSlot): VariableScope {
  return slot === "stroke" ? "stroke" : node.type === "text" ? "text" : "fill";
}

/** Unscoped color variables fit anywhere; a scoped one only where it says. */
export function colorScopeOk(variable: Variable, scope: VariableScope): boolean {
  return !variable.scopes || variable.scopes.length === 0 || variable.scopes.includes(scope);
}

/** Numbers must opt in: an unscoped number variable would match every field. */
export function numberScopeOk(variable: Variable, scopes: readonly VariableScope[]): boolean {
  return !!variable.scopes && variable.scopes.some((s) => scopes.includes(s));
}

function nodeLabel(node: FlatSceneNode): string {
  return node.name ? `"${node.name}"` : `${node.type} ${node.id}`;
}

export function preferSemantic<T extends { semantic: boolean; variable: Variable }>(list: T[]): T[] {
  return [...list].sort(
    (a, b) => Number(b.semantic) - Number(a.semantic) || a.variable.name.localeCompare(b.variable.name),
  );
}

function candidatesDetail(lc: LintContext, rest: Variable[]): string | undefined {
  if (rest.length === 0) return undefined;
  const refs = rest.slice(0, 5).map((v) => formatVariableRef(lc.input.variables, lc.input.collections, v));
  return `Other tokens with this value: ${refs.join(", ")}${rest.length > 5 ? ", ..." : ""}`;
}

/** Hardcoded colors and numbers that equal a token, plus the "near a token" info. */
export function runValueRules(lc: LintContext, enabled: ReadonlySet<LintRuleId>): void {
  const hardcoded = enabled.has("hardcoded-value");
  const offScale = enabled.has("off-scale-value");
  if (!hardcoded && !offScale) return;
  const found: Finding[] = [];
  const push = (f: Finding) => {
    found.push(f);
  };

  for (const base of lc.contexts) {
    const label = lc.label(base);
    for (const id of lc.scopeIds) {
      if (lc.expired()) break;
      const node = lc.node(id);
      if (!node) continue;
      const ctx = lc.effectiveModes(id, base);
      colorValues(lc, node, ctx, label, hardcoded, offScale, push);
      numberValues(lc, node, ctx, label, hardcoded, offScale, push);
    }
  }
  lc.addPerMode(found);
}

function colorValues(
  lc: LintContext,
  node: FlatSceneNode,
  ctx: ModeContext,
  mode: string,
  hardcoded: boolean,
  offScale: boolean,
  push: (f: Finding) => void,
): void {
  if (node.isMask) return;
  const tokens = lc.colorTokens(ctx);
  if (tokens.length === 0) return;
  const drawsStroke = strokeIsDrawn(node);
  for (const { slot, paint, paintId } of paintTargets(node)) {
    if (paint.type !== "solid" || paint.colorBinding || paint.styleId) continue;
    if (slot === "stroke" && !drawsStroke) continue;
    const literal = (paint as SolidPaint).color;
    const color = parseColor(literal);
    if (!color || color.a === 0) continue;
    const scope = scopeFor(node, slot);
    const scoped = tokens.filter((t) => colorScopeOk(t.variable, scope));
    const exact = preferSemantic(scoped.filter((t) => colorsEqual(t.color, color)));
    const shown = toHex(color);
    if (exact.length > 0) {
      if (!hardcoded) continue;
      const best = exact[0];
      const fix: LintFix = {
        kind: "bind-color",
        nodeId: node.id,
        slot,
        paintId,
        variableId: best.variable.id,
        from: literal,
      };
      push({
        id: findingId("hardcoded-value", node.id, slot, paintId ?? "legacy"),
        rule: "hardcoded-value",
        severity: "warning",
        nodeId: node.id,
        pageId: lc.input.pageId,
        message: `${slot === "stroke" ? "Stroke" : "Fill"} ${shown} on ${nodeLabel(node)} equals token ${formatVariableRef(lc.input.variables, lc.input.collections, best.variable)}; bind it.`,
        detail: candidatesDetail(
          lc,
          exact.slice(1).map((t) => t.variable),
        ),
        mode: mode || undefined,
        fix,
      });
      continue;
    }
    if (!offScale) continue;
    const nearest = nearestColor(scoped, color);
    if (nearest) {
      push({
        id: findingId("off-scale-value", node.id, slot, paintId ?? "legacy"),
        rule: "off-scale-value",
        severity: "info",
        nodeId: node.id,
        pageId: lc.input.pageId,
        message: `${slot === "stroke" ? "Stroke" : "Fill"} ${shown} on ${nodeLabel(node)} is close to token ${formatVariableRef(lc.input.variables, lc.input.collections, nearest.variable)} but not equal.`,
        mode: mode || undefined,
      });
    }
  }
}

function nearestColor(tokens: ColorToken[], color: ReturnType<typeof parseColor> & object): ColorToken | undefined {
  let best: ColorToken | undefined;
  let bestD = NEAR_COLOR_DISTANCE;
  for (const t of preferSemantic(tokens)) {
    const d = oklabDistance(t.color, color);
    if (d < bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

function numberValues(
  lc: LintContext,
  node: FlatSceneNode,
  ctx: ModeContext,
  mode: string,
  hardcoded: boolean,
  offScale: boolean,
  push: (f: Finding) => void,
): void {
  const layoutOn = !!(node as { layout?: { autoLayout?: boolean } }).layout?.autoLayout;
  let tokens: ReturnType<LintContext["numberTokens"]> | undefined;
  for (const key of NUMBER_BINDING_KEYS) {
    if (node.numberBindings?.[key]) continue;
    const spec = NUMBER_BINDING_SPECS[key];
    if (spec.where === "layout" && !layoutOn) continue;
    if (!isKeyActive(node, key)) continue;
    const value = readNumberField(node, key);
    if (value === undefined || value === 0 || (key === "opacity" && value === 1)) continue;
    tokens ??= lc.numberTokens(ctx);
    const scoped = tokens.filter((t) => numberScopeOk(t.variable, spec.scopes));
    if (scoped.length === 0) continue;
    const exact = preferSemantic(scoped.filter((t) => Math.abs(t.value - value) < 1e-6));
    if (exact.length > 0) {
      if (!hardcoded) continue;
      const best = exact[0];
      push({
        id: findingId("hardcoded-value", node.id, key),
        rule: "hardcoded-value",
        severity: "warning",
        nodeId: node.id,
        pageId: lc.input.pageId,
        message: `${key} ${value} on ${nodeLabel(node)} equals token ${formatVariableRef(lc.input.variables, lc.input.collections, best.variable)}; bind it.`,
        detail: candidatesDetail(
          lc,
          exact.slice(1).map((t) => t.variable),
        ),
        mode: mode || undefined,
        fix: { kind: "bind-number", nodeId: node.id, key, variableId: best.variable.id, from: value, changesValue: false },
      });
      continue;
    }
    if (!offScale) continue;
    const slack = key === "opacity" ? 0 : NEAR_NUMBER_PX;
    let nearest: (typeof scoped)[number] | undefined;
    for (const t of preferSemantic(scoped)) {
      const d = Math.abs(t.value - value);
      if (d > Math.max(slack, NEAR_NUMBER_RATIO * Math.abs(t.value))) continue;
      if (!nearest || d < Math.abs(nearest.value - value)) nearest = t;
    }
    if (nearest) {
      push({
        id: findingId("off-scale-value", node.id, key),
        rule: "off-scale-value",
        severity: "info",
        nodeId: node.id,
        pageId: lc.input.pageId,
        message: `${key} ${value} on ${nodeLabel(node)} is off the scale; nearest token ${formatVariableRef(lc.input.variables, lc.input.collections, nearest.variable)} is ${nearest.value}.`,
        mode: mode || undefined,
        fix: {
          kind: "bind-number",
          nodeId: node.id,
          key,
          variableId: nearest.variable.id,
          from: value,
          changesValue: true,
        },
      });
    }
  }
}

/** The live replacement for a deprecated variable: follows `replacedBy` while the target is itself deprecated. */
export function replacementFor(lc: LintContext, variable: Variable): Variable | undefined {
  let cur = variable;
  const seen = new Set<string>([cur.id]);
  for (let hop = 0; hop < MAX_REPLACEMENT_HOPS; hop++) {
    const nextId = cur.deprecated?.replacedBy;
    if (!nextId) return undefined;
    const next = lc.index.byId.get(nextId);
    if (!next || seen.has(next.id) || next.type !== variable.type) return undefined;
    if (!next.deprecated) return next;
    seen.add(next.id);
    cur = next;
  }
  return undefined;
}

/** Bindings that point at a deprecated token, directly or through an alias chain. */
export function runDeprecatedTokenRule(lc: LintContext): void {
  const base = lc.contexts[0];
  const ref = (v: Variable) => formatVariableRef(lc.input.variables, lc.input.collections, v);

  const check = (
    node: FlatSceneNode,
    variableId: string,
    target: ColorSlot | NumberBindingKey,
    paintId: string | undefined,
    ctx: ModeContext,
  ) => {
    const variable = lc.index.byId.get(variableId);
    if (!variable) return;
    const result = lc.resolveChain(variableId, ctx);
    const deprecatedHop = result.map((id) => lc.index.byId.get(id)).find((v) => v?.deprecated);
    if (!deprecatedHop) return;
    const direct = deprecatedHop.id === variable.id;
    const replacement = direct ? replacementFor(lc, variable) : undefined;
    const note = deprecatedHop.deprecated?.note;
    lc.add({
      id: findingId("deprecated-token", node.id, target, paintId ?? ""),
      rule: "deprecated-token",
      severity: "warning",
      nodeId: node.id,
      pageId: lc.input.pageId,
      message: direct
        ? `${nodeLabel(node)} uses deprecated token ${ref(variable)} (${target}).`
        : `${nodeLabel(node)} uses ${ref(variable)} (${target}), which resolves through deprecated token ${ref(deprecatedHop)}.`,
      detail: [
        replacement ? `Replacement: ${ref(replacement)}.` : undefined,
        note ? `Note: ${note}` : undefined,
      ]
        .filter(Boolean)
        .join(" ") || undefined,
      fix: replacement
        ? { kind: "rebind", nodeId: node.id, target, paintId, fromVariableId: variable.id, toVariableId: replacement.id }
        : undefined,
    });
  };

  for (const id of lc.scopeIds) {
    if (lc.expired()) return;
    const node = lc.node(id);
    if (!node) continue;
    const ctx = lc.effectiveModes(id, base);
    for (const { slot, paint, paintId } of paintTargets(node)) {
      if (paint.type === "solid" && paint.colorBinding) check(node, paint.colorBinding.variableId, slot, paintId, ctx);
    }
    for (const key of Object.keys(node.numberBindings ?? {}) as NumberBindingKey[]) {
      const binding = node.numberBindings?.[key];
      if (binding) check(node, binding.variableId, key, undefined, ctx);
    }
  }
}
