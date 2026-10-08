import type { EmbedNode, FlatSceneNode, LayoutProperties, NumberBindingKey, Paint, SolidPaint } from "@/types/scene";
import type { ModeContext } from "@/types/variable";
import { useSceneStore } from "@/store/sceneStore";
import { useVariableStore } from "@/store/variableStore";
import { useThemeStore } from "@/store/themeStore";
import { usePageStore } from "@/store/pageStore";
import { selectComponentRegistry } from "@/store/componentRegistry";
import { applyEmbedHtmlUpdates } from "@/store/componentOps";
import { withHistoryBatch } from "@/store/historyStore";
import { saveHistory } from "@/store/sceneStore/helpers/history";
import { isLibraryComponent } from "@/lib/designSystem/ownership";
import { parseEmbedHtml, serializeEmbedDoc } from "@/lib/embedHtmlDocument";
import { hasStaleRegions, reconcileHtml } from "@/lib/embedComponents";
import type { ComponentRegistry } from "@/lib/embedComponents";
import { bindSolidPaint } from "@/lib/tools/replaceAllMatchingProperties";
import {
  NUMBER_BINDING_SPECS,
  buildVariableIndex,
  clampForKey,
  completeModeContext,
  getEffectiveModeContext,
  isKeyActive,
  isNumberBindingKey,
  readNumberField,
  resolveVariable,
  type VariableIndex,
} from "@/lib/variables";
import { inManagedZone } from "./embedDom";
import type { ColorSlot, Finding, LintFix, LintRuleId } from "./types";

export type FixSkipReason =
  /** The document no longer holds the value the fix expected. */
  | "stale"
  /** The node or its component belongs to a linked library. */
  | "library"
  /** The finding is on another page; v1 fixes the active page only. */
  | "other-page"
  /** The fix changes a value (off-scale snap); needs an explicit request. */
  | "changes-value";

export interface ApplyLintFixesResult {
  /** Ids of the findings whose fix was written. */
  applied: string[];
  skipped: Array<{ id: string; reason: FixSkipReason }>;
}

export interface ApplyLintFixesOptions {
  /** Also apply fixes that change a value (the off-scale snap to the nearest token). */
  allowValueChanges?: boolean;
}

/** A finding that carries a machine-applicable fix. */
export type FixableFinding = Finding & { fix: LintFix };

export function isFixable(f: Finding): f is FixableFinding {
  return f.fix !== undefined;
}

/**
 * Contrast first (a passing token must win over an exact-match one), then
 * deprecated tokens, then the rest.
 */
const RULE_PRIORITY: Partial<Record<LintRuleId, number>> = {
  contrast: 0,
  "deprecated-token": 1,
  "hardcoded-value": 2,
  "off-scale-value": 3,
  "embed-literal": 4,
  "component-drift": 5,
};

type Patch = Record<string, unknown>;

const sameColor = (a: unknown, b: unknown): boolean =>
  typeof a === "string" && typeof b === "string" && a.trim().toLowerCase() === b.trim().toLowerCase();

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replace `from` with `to` inside the value of every `property` declaration in `text`. Null when nothing matched. */
function replaceDeclarationValue(text: string, property: string, from: string, to: string): string | null {
  const re = new RegExp(
    `((?:^|[;{\\s])${escapeRe(property)}\\s*:[^;{}]*?)(?<![\\w.-])${escapeRe(from)}(?![\\w-])`,
    "gi",
  );
  const next = text.replace(re, (_m, head: string) => `${head}${to}`);
  return next === text ? null : next;
}

/**
 * Replace a literal inside an embed's own inline styles and `<style>` blocks.
 * Managed regions (rendered from a component master) and `data-c-style`
 * copies are left alone: their literals belong to the master.
 */
function replaceEmbedLiteral(html: string, masterKey: string | undefined, fix: Extract<LintFix, { kind: "embed-replace" }>): string | null {
  const doc = parseEmbedHtml(html);
  if (!doc) return null;
  let changed = false;
  for (const el of Array.from(doc.querySelectorAll("[style]"))) {
    if (inManagedZone(el, masterKey)) continue;
    const next = replaceDeclarationValue(el.getAttribute("style") ?? "", fix.property, fix.from, fix.to);
    if (next !== null) {
      el.setAttribute("style", next);
      changed = true;
    }
  }
  for (const style of Array.from(doc.querySelectorAll("style")).filter((s) => !s.hasAttribute("data-c-style"))) {
    const next = replaceDeclarationValue(style.textContent ?? "", fix.property, fix.from, fix.to);
    if (next !== null) {
      style.textContent = next;
      changed = true;
    }
  }
  return changed ? serializeEmbedDoc(html, doc) : null;
}

/** Library masters are read-only; so is anything the fix would have to write through one. */
function isLibraryNode(node: FlatSceneNode): boolean {
  return node.type === "embed" && isLibraryComponent((node as unknown as EmbedNode).component);
}

class FixSession {
  /** Working copies of the nodes touched so far. */
  readonly nodes = new Map<string, FlatSceneNode>();
  readonly html = new Map<string, string>();
  private readonly applied = new Set<string>();
  private readonly index: VariableIndex;
  private readonly base: ModeContext;
  private readonly state = useSceneStore.getState();
  private readonly registry: ComponentRegistry = selectComponentRegistry();

  constructor() {
    const { variables, collections } = useVariableStore.getState();
    this.index = buildVariableIndex(variables, collections);
    this.base = completeModeContext(collections, useThemeStore.getState().modeContext);
  }

  node(id: string): FlatSceneNode | undefined {
    return this.nodes.get(id) ?? this.state.nodesById[id];
  }

  private put(node: FlatSceneNode, patch: Patch): void {
    this.nodes.set(node.id, { ...node, ...patch } as FlatSceneNode);
  }

  /** The variable's value under the node's effective mode context, or undefined when it cannot resolve to `type`. */
  private resolved(variableId: string, nodeId: string, type: "color" | "number"): string | undefined {
    if (this.index.byId.get(variableId)?.type !== type) return undefined;
    const ctx = getEffectiveModeContext(
      this.state.parentById,
      this.state.nodesById as Record<string, { type?: string; modeOverrides?: Record<string, string> }>,
      nodeId,
      this.base,
    );
    const r = resolveVariable(this.index, variableId, ctx);
    return r.ok ? r.value : undefined;
  }

  apply(finding: FixableFinding, opts: ApplyLintFixesOptions): FixSkipReason | null {
    const { fix } = finding;
    const node = this.node(fix.nodeId);
    if (!node || finding.pageId !== usePageStore.getState().activePageId) return "other-page";
    if (isLibraryNode(node)) return "library";
    switch (fix.kind) {
      case "bind-color":
        return this.bindColor(node, fix);
      case "bind-number":
        return fix.changesValue && !opts.allowValueChanges ? "changes-value" : this.bindNumber(node, fix);
      case "rebind":
        return this.rebind(node, fix);
      case "embed-replace":
        return this.embedReplace(node, fix);
      case "reconcile-component":
        return this.reconcile(node, fix);
    }
  }

  /** Swap the solid paint addressed by `slot` / `paintId` (or the legacy single field) through `edit`. */
  private editPaint(
    node: FlatSceneNode,
    slot: ColorSlot,
    paintId: string | undefined,
    edit: (paint: SolidPaint) => SolidPaint | null,
  ): boolean {
    const stackKey = slot === "fill" ? "fills" : "strokes";
    const stack = node[stackKey] as Paint[] | undefined;
    if (paintId !== undefined || stack) {
      const at = stack?.findIndex((p) => p.id === paintId) ?? -1;
      const paint = stack?.[at];
      if (!stack || !paint || paint.type !== "solid") return false;
      const next = edit(paint);
      if (!next) return false;
      this.put(node, { [stackKey]: stack.map((p, i) => (i === at ? next : p)) });
      return true;
    }
    const literalKey = slot === "fill" ? "fill" : "stroke";
    const bindingKey = slot === "fill" ? "fillBinding" : "strokeBinding";
    const literal = node[literalKey];
    if (literal === undefined) return false;
    const next = edit({
      id: "legacy",
      type: "solid",
      color: literal,
      colorBinding: node[bindingKey],
    } as SolidPaint);
    if (!next) return false;
    this.put(node, { [literalKey]: next.color, [bindingKey]: next.colorBinding });
    return true;
  }

  private bindColor(node: FlatSceneNode, fix: Extract<LintFix, { kind: "bind-color" }>): FixSkipReason | null {
    const value = this.resolved(fix.variableId, node.id, "color");
    if (value === undefined) return "stale";
    const done = this.editPaint(node, fix.slot, fix.paintId, (paint) =>
      paint.colorBinding || paint.styleId || !sameColor(paint.color, fix.from)
        ? null
        : bindSolidPaint(paint, value, { variableId: fix.variableId }),
    );
    return done ? null : "stale";
  }

  private setNumberBinding(node: FlatSceneNode, key: NumberBindingKey, variableId: string, value: number): void {
    const patch: Patch = { numberBindings: { ...node.numberBindings, [key]: { variableId } } };
    if (NUMBER_BINDING_SPECS[key].where === "layout") {
      patch.layout = { ...(node as unknown as { layout?: LayoutProperties }).layout, [key]: value };
    } else {
      patch[key] = value;
    }
    this.put(node, patch);
  }

  private numberValue(node: FlatSceneNode, variableId: string): number | undefined {
    const raw = this.resolved(variableId, node.id, "number");
    const value = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
    return Number.isFinite(value) ? value : undefined;
  }

  private bindNumber(node: FlatSceneNode, fix: Extract<LintFix, { kind: "bind-number" }>): FixSkipReason | null {
    if (!isNumberBindingKey(fix.key) || node.numberBindings?.[fix.key] || !isKeyActive(node, fix.key)) return "stale";
    if (readNumberField(node, fix.key) !== fix.from) return "stale";
    const value = this.numberValue(node, fix.variableId);
    if (value === undefined) return "stale";
    this.setNumberBinding(node, fix.key, fix.variableId, clampForKey(fix.key, value));
    return null;
  }

  private rebind(node: FlatSceneNode, fix: Extract<LintFix, { kind: "rebind" }>): FixSkipReason | null {
    if (fix.target === "fill" || fix.target === "stroke") {
      const value = this.resolved(fix.toVariableId, node.id, "color");
      if (value === undefined) return "stale";
      const done = this.editPaint(node, fix.target, fix.paintId, (paint) =>
        paint.colorBinding?.variableId === fix.fromVariableId
          ? bindSolidPaint(paint, value, { variableId: fix.toVariableId })
          : null,
      );
      return done ? null : "stale";
    }
    const key = fix.target;
    if (!isNumberBindingKey(key) || node.numberBindings?.[key]?.variableId !== fix.fromVariableId) return "stale";
    const value = this.numberValue(node, fix.toVariableId);
    if (value === undefined) return "stale";
    this.setNumberBinding(node, key, fix.toVariableId, clampForKey(key, value));
    return null;
  }

  private embedHtml(node: FlatSceneNode): string | undefined {
    if (node.type !== "embed") return undefined;
    return this.html.get(node.id) ?? (node as unknown as EmbedNode).htmlContent;
  }

  private embedReplace(node: FlatSceneNode, fix: Extract<LintFix, { kind: "embed-replace" }>): FixSkipReason | null {
    const html = this.embedHtml(node);
    if (!html) return "stale";
    const key = `${node.id}\u0000${fix.property}\u0000${fix.from}\u0000${fix.to}`;
    // One replacement rewrites every identical declaration of the embed, so a repeat is already done.
    if (this.applied.has(key)) return null;
    const next = replaceEmbedLiteral(html, (node as unknown as EmbedNode).component?.key, fix);
    if (next === null) return "stale";
    this.applied.add(key);
    this.html.set(node.id, next);
    return null;
  }

  private reconcile(node: FlatSceneNode, fix: Extract<LintFix, { kind: "reconcile-component" }>): FixSkipReason | null {
    const html = this.embedHtml(node);
    const master = this.registry.get(fix.key);
    if (!html || !master) return "stale";
    const only: ComponentRegistry = new Map([[fix.key, master]]);
    if (!hasStaleRegions(html, only)) return "stale";
    const next = reconcileHtml(html, only);
    if (next === html) return "stale";
    this.html.set(node.id, next);
    return null;
  }
}

/**
 * Apply lint fixes to the ACTIVE page as one undo step. Every fix is checked
 * against the live document right before it is written (the value it expects
 * must still be there), so a finding that went stale since the last run is
 * skipped, never forced. Fixes on other pages, on library-owned masters, and
 * value-changing fixes (unless `allowValueChanges`) are skipped too. Variables
 * are never written.
 *
 * Undo caveat: the step lives in the active page's history; switching pages
 * keeps each page's own stack.
 */
export function applyLintFixes(findings: readonly Finding[], opts: ApplyLintFixesOptions = {}): ApplyLintFixesResult {
  const result: ApplyLintFixesResult = { applied: [], skipped: [] };
  const fixable = findings
    .filter(isFixable)
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (RULE_PRIORITY[a.f.rule] ?? 9) - (RULE_PRIORITY[b.f.rule] ?? 9) || a.i - b.i)
    .map((x) => x.f);
  if (fixable.length === 0) return result;

  const session = new FixSession();
  for (const finding of fixable) {
    const reason = session.apply(finding, opts);
    if (reason) result.skipped.push({ id: finding.id, reason });
    else result.applied.push(finding.id);
  }
  if (result.applied.length === 0) return result;

  const patches: Record<string, Partial<FlatSceneNode>> = {};
  for (const [id, node] of session.nodes) patches[id] = node;
  const htmlUpdates = [...session.html].map(([nodeId, html]) => ({ nodeId, html }));

  const state = useSceneStore.getState();
  saveHistory(state);
  // Inside the batch the store mutators skip their own history saves, so the
  // snapshot above is the one and only undo step.
  withHistoryBatch(() => {
    if (Object.keys(patches).length > 0) state.updateNodesById(patches as never);
    applyEmbedHtmlUpdates(htmlUpdates);
  });
  return result;
}
