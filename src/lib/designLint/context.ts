import type { EmbedNode, FlatSceneNode, SceneNode } from "@/types/scene";
import type { ModeContext, Variable, VariableCollection } from "@/types/variable";
import { useSceneStore } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useVariableStore } from "@/store/variableStore";
import { useThemeStore } from "@/store/themeStore";
import { usePageStore } from "@/store/pageStore";
import { selectComponentRegistry, selectDuplicateMasters } from "@/store/componentRegistry";
import { listAllEmbeds } from "@/store/componentOps";
import { prepareFrameNode } from "@/utils/instanceUtils";
import { shortHash } from "@/lib/embedComponents";
import {
  buildVariableIndex,
  completeModeContext,
  getEffectiveModeContext,
  modeContextKey,
  modeValuesOf,
  resolveVariable,
  type VariableIndex,
} from "@/lib/variables";
import { parseColor, type Rgba } from "./colorMath";
import type { Finding, LintEmbed, LintInput, LintOptions, Rect } from "./types";

export const DEFAULT_MAX_MODES = 8;
export const DEFAULT_MAX_NODES = 20_000;
export const DEFAULT_MAX_EMBEDS = 50;

/** The only impure function of the lint: snapshot the active page and the document-wide data. */
export function buildLintInput(): LintInput {
  const scene = useSceneStore.getState();
  const rects: Record<string, Rect> = {};
  const calc = useLayoutStore.getState().calculateLayoutForFrame;

  const walk = (children: SceneNode[], offX: number, offY: number) => {
    for (const node of children) {
      let width = node.width;
      let height = node.height;
      let kids: SceneNode[] | undefined;
      if (node.type === "frame") {
        const prepared = prepareFrameNode(node, calc);
        width = prepared.effectiveWidth;
        height = prepared.effectiveHeight;
        kids = prepared.layoutChildren;
      } else if (node.type === "group") {
        kids = node.children;
      }
      const x = offX + node.x;
      const y = offY + node.y;
      rects[node.id] = { x, y, width, height };
      if (kids) walk(kids, x, y);
    }
  };
  walk(scene.getNodes(), 0, 0);

  const pageId = usePageStore.getState().activePageId;
  const { variables, collections } = useVariableStore.getState();
  return {
    pageId,
    nodesById: scene.nodesById,
    parentById: scene.parentById,
    childrenById: scene.childrenById,
    rootIds: scene.rootIds,
    rects,
    pageBackground: scene.pageBackground,
    variables,
    collections,
    baseModes: useThemeStore.getState().modeContext,
    registry: selectComponentRegistry(),
    duplicateMasters: selectDuplicateMasters(),
    embeds: listAllEmbeds().map(({ node, pageId: embedPageId }: { node: EmbedNode; pageId: string }) => ({
      nodeId: node.id,
      pageId: embedPageId,
      html: node.htmlContent ?? "",
      masterKey: node.component?.key,
    })),
  };
}

/** A color variable resolved under one mode context. */
export interface ColorToken {
  variable: Variable;
  color: Rgba;
  /** An alias onto another token (semantic tier) rather than a raw value (primitive tier). */
  semantic: boolean;
}

export interface NumberToken {
  variable: Variable;
  value: number;
  semantic: boolean;
}

export function isSemantic(variable: Variable): boolean {
  return Object.values(modeValuesOf(variable)).some((v) => typeof v !== "string");
}

/** Stable finding id: rule plus the identity of the offending thing, never the message. */
export function findingId(rule: string, ...parts: Array<string | number | undefined>): string {
  return `${rule}:${shortHash(parts.map((p) => p ?? "").join("\u0001"))}`;
}

/** Every combination of collection modes, the base context first, at most `cap`. */
export function enumerateModeContexts(
  collections: Iterable<VariableCollection>,
  base: ModeContext,
  cap: number,
): ModeContext[] {
  const list = [...collections];
  const first = completeModeContext(list, base);
  const out: ModeContext[] = [first];
  for (const c of list) {
    const snapshot = [...out];
    for (const mode of c.modes) {
      if (mode.id === first[c.id]) continue;
      for (const ctx of snapshot) {
        if (out.length >= cap) return out;
        out.push({ ...ctx, [c.id]: mode.id });
      }
    }
  }
  return out;
}

/** "Theme=dark, Brand=B": collections with a single mode are left out. */
export function modeLabel(collections: Iterable<VariableCollection>, ctx: ModeContext): string {
  const parts: string[] = [];
  for (const c of collections) {
    if (c.modes.length < 2) continue;
    const mode = c.modes.find((m) => m.id === ctx[c.id]);
    parts.push(`${c.name}=${mode?.name ?? ctx[c.id] ?? c.defaultModeId}`);
  }
  return parts.join(", ");
}

export function isNodeHidden(node: FlatSceneNode | undefined): boolean {
  return !node || node.visible === false || node.enabled === false;
}

/** Shared state of one lint run. Rules read from it and push findings. */
export class LintContext {
  readonly index: VariableIndex;
  readonly contexts: ModeContext[];
  /** Visible nodes in scope, parents before children, in z-order. */
  readonly scopeIds: string[] = [];
  /** Embeds in scope (all pages when unscoped). */
  readonly embeds: LintEmbed[] = [];
  readonly findings: Finding[] = [];
  truncated = false;
  embedsPartial = 0;
  private readonly deadline: number;
  private readonly now: () => number;
  private readonly colorTokenCache = new Map<string, ColorToken[]>();
  private readonly numberTokenCache = new Map<string, NumberToken[]>();

  readonly input: LintInput;
  readonly opts: LintOptions;

  constructor(input: LintInput, opts: LintOptions = {}) {
    this.input = input;
    this.opts = opts;
    this.index = buildVariableIndex(input.variables, input.collections);
    this.contexts = opts.modes?.length
      ? opts.modes.map((m) => completeModeContext([...this.index.collections.values()], m))
      : enumerateModeContexts(this.index.collections.values(), input.baseModes, opts.maxModes ?? DEFAULT_MAX_MODES);
    const now = opts.now ?? Date.now;
    this.deadline = opts.budgetMs === undefined ? Infinity : now() + opts.budgetMs;
    this.now = now;
    this.collectScope();
  }

  /** True once the time budget is spent; marks the run truncated. */
  expired(): boolean {
    if (this.now() <= this.deadline) return false;
    this.truncated = true;
    return true;
  }

  get collections(): VariableCollection[] {
    return [...this.index.collections.values()];
  }

  label(ctx: ModeContext): string {
    return modeLabel(this.index.collections.values(), ctx);
  }

  node(id: string): FlatSceneNode | undefined {
    return this.input.nodesById[id];
  }

  /** The context a node resolves under: `base` plus every ancestor frame's overrides. */
  effectiveModes(nodeId: string, base: ModeContext): ModeContext {
    return getEffectiveModeContext(
      this.input.parentById as Record<string, string | null>,
      this.input.nodesById as Record<string, { type?: string; modeOverrides?: Record<string, string> } | undefined>,
      nodeId,
      base,
    );
  }

  /** The value of a variable under `ctx`, or undefined when it cannot resolve. */
  resolve(variableId: string, ctx: ModeContext): string | undefined {
    const r = resolveVariable(this.index, variableId, ctx);
    return r.ok ? r.value : undefined;
  }

  /** Ids along the alias chain of a variable under `ctx` (partial when resolution fails). */
  resolveChain(variableId: string, ctx: ModeContext): string[] {
    return resolveVariable(this.index, variableId, ctx).chain;
  }

  /** Non-deprecated color variables that resolve to a literal color under `ctx`. */
  colorTokens(ctx: ModeContext): ColorToken[] {
    const key = modeContextKey(ctx);
    const hit = this.colorTokenCache.get(key);
    if (hit) return hit;
    const out: ColorToken[] = [];
    for (const variable of this.input.variables) {
      if (variable.type !== "color" || variable.deprecated) continue;
      const color = parseColor(this.resolve(variable.id, ctx));
      if (color) out.push({ variable, color, semantic: isSemantic(variable) });
    }
    this.colorTokenCache.set(key, out);
    return out;
  }

  numberTokens(ctx: ModeContext): NumberToken[] {
    const key = modeContextKey(ctx);
    const hit = this.numberTokenCache.get(key);
    if (hit) return hit;
    const out: NumberToken[] = [];
    for (const variable of this.input.variables) {
      if (variable.type !== "number" || variable.deprecated) continue;
      const raw = this.resolve(variable.id, ctx);
      const value = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
      if (Number.isFinite(value)) out.push({ variable, value, semantic: isSemantic(variable) });
    }
    this.numberTokenCache.set(key, out);
    return out;
  }

  add(finding: Finding): void {
    this.findings.push(finding);
  }

  /**
   * Add findings produced once per mode context. A finding that holds in every
   * context is reported once without a mode; one that holds in some is
   * reported with the list of modes (and an id that includes them).
   */
  addPerMode(perMode: Finding[]): void {
    const groups = new Map<string, { f: Finding; modes: string[] }>();
    for (const f of perMode) {
      const key = `${f.id}\u0000${f.message}\u0000${f.detail ?? ""}`;
      const g = groups.get(key);
      if (g) g.modes.push(f.mode ?? "");
      else groups.set(key, { f, modes: [f.mode ?? ""] });
    }
    for (const { f, modes } of groups.values()) {
      if (modes.length >= this.contexts.length || !modes[0]) this.add({ ...f, mode: undefined });
      else this.add({ ...f, id: `${f.id}@${shortHash(modes.join("|"))}`, mode: modes.join("; ") });
    }
  }

  private ancestorHidden(id: string): boolean {
    let cur = this.input.parentById[id] ?? null;
    const seen = new Set<string>();
    while (cur != null && !seen.has(cur)) {
      seen.add(cur);
      if (isNodeHidden(this.node(cur))) return true;
      cur = this.input.parentById[cur] ?? null;
    }
    return false;
  }

  private collectScope(): void {
    const { input, opts } = this;
    const maxNodes = opts.maxNodes ?? DEFAULT_MAX_NODES;
    const scoped = opts.nodeIds !== undefined;
    const roots = scoped ? opts.nodeIds!.filter((id) => input.nodesById[id] && !this.ancestorHidden(id)) : input.rootIds;
    const seen = new Set<string>();
    const stack = [...roots].reverse();
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (isNodeHidden(this.node(id))) continue;
      if (this.scopeIds.length >= maxNodes) {
        this.truncated = true;
        break;
      }
      this.scopeIds.push(id);
      const kids = input.childrenById[id];
      if (kids) for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
    }

    const inScope = new Set(this.scopeIds);
    const maxEmbeds = opts.maxEmbeds ?? DEFAULT_MAX_EMBEDS;
    for (const embed of input.embeds) {
      // Embeds of this page follow the node scope (hidden ones are skipped); other pages only when unscoped.
      if (embed.pageId === input.pageId ? !inScope.has(embed.nodeId) : scoped) continue;
      if (embed.pageId !== input.pageId && !embed.html) continue;
      if (this.embeds.length >= maxEmbeds) {
        this.truncated = true;
        break;
      }
      this.embeds.push(embed);
    }
  }
}
