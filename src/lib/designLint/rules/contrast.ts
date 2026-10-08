import type { FlatSceneNode, Paint, TextNode } from "@/types/scene";
import type { ModeContext } from "@/types/variable";
import { getPrimarySolidPaint, getRenderableFills, getRenderableStrokes } from "@/utils/fillUtils";
import { TEXT_LINK_COLOR } from "@/lib/textLink";
import {
  compositeOver,
  contrastRatio,
  formatRatio,
  isLargeText,
  parseColor,
  requiredRatio,
  toHex,
  withAlphaFactor,
  type Rgba,
} from "../colorMath";
import { findingId, isNodeHidden, type LintContext } from "../context";
import { nodeLabel, strokeIsDrawn } from "../shared";
import type { Finding, Rect } from "../types";

const OPAQUE = 0.999;
const MAX_SAMPLES = 24;
const MAX_DEPTH = 12;
const EPS = 1e-9;
const UI_RATIO = 3;

/** What a paint puts on screen, once variables and opacity are applied. */
type Layer =
  | { kind: "solid"; color: Rgba }
  | { kind: "gradient"; colors: Rgba[] }
  | { kind: "unresolved" };

function layerIsOpaque(layer: Layer): boolean {
  if (layer.kind === "solid") return layer.color.a >= OPAQUE;
  if (layer.kind === "gradient") return layer.colors.every((c) => c.a >= OPAQUE);
  return false;
}

function paintLayer(lc: LintContext, node: FlatSceneNode, paint: Paint, ctx: ModeContext): Layer {
  if (paint.blendMode && paint.blendMode !== "normal") return { kind: "unresolved" };
  const factor = (paint.opacity ?? 1) * (node.opacity ?? 1);
  if (paint.type === "solid") {
    if (paint.styleId) return { kind: "unresolved" };
    const raw = paint.colorBinding ? (lc.resolve(paint.colorBinding.variableId, ctx) ?? paint.color) : paint.color;
    const color = parseColor(raw);
    return color ? { kind: "solid", color: withAlphaFactor(color, factor) } : { kind: "unresolved" };
  }
  if (paint.type === "gradient") {
    const colors: Rgba[] = [];
    for (const stop of paint.gradient.stops) {
      const color = parseColor(stop.color);
      if (!color) return { kind: "unresolved" };
      colors.push(withAlphaFactor(color, factor * (stop.opacity ?? 1)));
    }
    return colors.length > 0 ? { kind: "gradient", colors } : { kind: "unresolved" };
  }
  return { kind: "unresolved" };
}

/** The node's fill layers, topmost first. */
function fillLayers(lc: LintContext, node: FlatSceneNode, ctx: ModeContext): Layer[] {
  return getRenderableFills(node)
    .map((p) => paintLayer(lc, node, p, ctx))
    .reverse();
}

function contains(outer: Rect, inner: Rect, tol = 0.5): boolean {
  return (
    outer.x <= inner.x + tol &&
    outer.y <= inner.y + tol &&
    outer.x + outer.width >= inner.x + inner.width - tol &&
    outer.y + outer.height >= inner.y + inner.height - tol
  );
}

function insideEllipse(outer: Rect, inner: Rect): boolean {
  const cx = outer.x + outer.width / 2;
  const cy = outer.y + outer.height / 2;
  const rx = outer.width / 2;
  const ry = outer.height / 2;
  if (rx <= 0 || ry <= 0) return false;
  return [
    [inner.x, inner.y],
    [inner.x + inner.width, inner.y],
    [inner.x, inner.y + inner.height],
    [inner.x + inner.width, inner.y + inner.height],
  ].every(([x, y]) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 + EPS);
}

/** Does this node paint over the whole of `rect`? Only boxes and ellipses claim coverage. */
function covers(node: FlatSceneNode, r: Rect | undefined, target: Rect): boolean {
  if (!r) return false;
  if (node.type === "rect" || node.type === "frame") return contains(r, target);
  if (node.type === "ellipse") return insideEllipse(r, target);
  return false;
}

interface Backdrop {
  /** Possible opaque backdrops (several for a gradient). */
  samples: Rgba[];
  gradient: boolean;
}

/**
 * Layers painted behind `target` at `startId`, topmost first, up to and
 * including the first opaque one. A container that covers the target
 * contributes its covering children before its own fill.
 */
class BackdropWalker {
  readonly layers: Layer[] = [];
  done = false;

  private readonly lc: LintContext;
  private readonly base: ModeContext;
  private readonly target: Rect;

  constructor(lc: LintContext, base: ModeContext, target: Rect) {
    this.lc = lc;
    this.base = base;
    this.target = target;
  }

  private push(nodeId: string): void {
    const node = this.lc.node(nodeId);
    if (!node) return;
    for (const layer of fillLayers(this.lc, node, this.lc.effectiveModes(nodeId, this.base))) {
      this.layers.push(layer);
      if (layerIsOpaque(layer) || layer.kind === "unresolved") {
        this.done = true;
        return;
      }
    }
  }

  /** `nodeId` as a backdrop: covering children first (topmost first), then its own fill. */
  take(nodeId: string, depth = 0): void {
    if (this.done || depth > MAX_DEPTH) return;
    const { lc } = this;
    const node = lc.node(nodeId);
    if (!node || isNodeHidden(node) || !covers(node, lc.input.rects[nodeId], this.target)) return;
    if (node.type === "frame" || node.type === "group") {
      const kids = lc.input.childrenById[nodeId] ?? [];
      for (let i = kids.length - 1; i >= 0 && !this.done; i--) this.take(kids[i], depth + 1);
    }
    if (!this.done) this.push(nodeId);
  }

  /** Walk from `startId` outward: earlier siblings, then the parent, and so on. */
  from(startId: string): void {
    const { lc } = this;
    let cur = startId;
    const seen = new Set<string>();
    while (!this.done && !seen.has(cur)) {
      seen.add(cur);
      const parent = lc.input.parentById[cur] ?? null;
      const siblings = parent ? (lc.input.childrenById[parent] ?? []) : lc.input.rootIds;
      for (let j = siblings.indexOf(cur) - 1; j >= 0 && !this.done; j--) this.take(siblings[j]);
      if (this.done || !parent) break;
      const p = lc.node(parent);
      if (p && !isNodeHidden(p) && (p.type === "frame" || p.type === "rect")) this.push(parent);
      cur = parent;
    }
  }
}

/** Resolve the backdrop behind a node, or null when an image / unknown paint is in the way. */
function backdropOf(lc: LintContext, base: ModeContext, nodeId: string, target: Rect): Backdrop | null {
  const walker = new BackdropWalker(lc, base, target);
  walker.from(nodeId);
  const layers = walker.layers;
  if (layers.some((l) => l.kind === "unresolved")) return null;
  const page = parseColor(lc.input.pageBackground) ?? { r: 255, g: 255, b: 255, a: 1 };
  let samples: Rgba[] = [{ ...page, a: 1 }];
  let gradient = false;
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (layer.kind === "unresolved") return null;
    const colors = layer.kind === "solid" ? [layer.color] : layer.colors;
    if (layer.kind === "gradient") gradient = true;
    const next = new Map<string, Rgba>();
    for (const s of samples) for (const c of colors) {
      const out = compositeOver(c, s);
      next.set(toHex(out), out);
    }
    samples = [...next.values()].slice(0, MAX_SAMPLES);
  }
  return { samples, gradient };
}

interface Worst {
  ratio: number;
  fg: Rgba;
  bg: Rgba;
}

function worstRatio(fgs: Rgba[], bgs: Rgba[]): Worst {
  let worst: Worst | undefined;
  for (const bg of bgs) {
    for (const f of fgs) {
      const fg = compositeOver(f, bg);
      const ratio = contrastRatio(fg, bg);
      if (!worst || ratio < worst.ratio) worst = { ratio, fg, bg };
    }
  }
  return worst as Worst;
}


/**
 * The text's foreground colors, as the text renderer draws them: the topmost
 * visible SOLID paint (gradients and images are ignored), else the legacy
 * `fill`; with neither, black, or link blue for a linked node. Null when the
 * chosen paint cannot be read (style, blend mode, unknown variable).
 */
function foregroundOf(lc: LintContext, node: TextNode, ctx: ModeContext): { colors: Rgba[]; gradient: boolean } | null {
  const paint: Paint | undefined = node.fills
    ? getPrimarySolidPaint(node)
    : node.fill !== undefined
      ? { id: "legacy-fill", type: "solid", color: node.fill, opacity: node.fillOpacity, colorBinding: node.fillBinding }
      : undefined;
  if (!paint) {
    const fallback = parseColor(node.link ? TEXT_LINK_COLOR : "#000000");
    return fallback ? { colors: [withAlphaFactor(fallback, node.opacity ?? 1)], gradient: false } : null;
  }
  const layer = paintLayer(lc, node, paint, ctx);
  return layer.kind === "solid" ? { colors: [layer.color], gradient: false } : null;
}

/** Native contrast: text against its backdrop (WCAG AA), optionally strokes against 3:1. */
export function runContrastRule(lc: LintContext): void {
  const seenUnresolved = new Set<string>();
  const found: Finding[] = [];
  let evaluated = 0;
  for (const base of lc.contexts) {
    if (lc.expired()) break;
    evaluated++;
    const mode = lc.label(base);
    for (const id of lc.scopeIds) {
      if (lc.expired()) break;
      const node = lc.node(id);
      const rect = lc.input.rects[id];
      if (!node || !rect) continue;
      if (node.type === "text" && (node as TextNode).text?.trim()) {
        textContrast(lc, node as TextNode, rect, base, mode, found, seenUnresolved);
      } else if (lc.opts.uiContrast && (node.type === "rect" || node.type === "ellipse" || node.type === "frame")) {
        strokeContrast(lc, node, rect, base, mode, found);
      }
    }
  }
  lc.addPerMode(found, evaluated);
}

function textContrast(
  lc: LintContext,
  node: TextNode,
  rect: Rect,
  base: ModeContext,
  mode: string,
  found: Finding[],
  seenUnresolved: Set<string>,
): void {
  const ctx = lc.effectiveModes(node.id, base);
  const fg = foregroundOf(lc, node, ctx);
  const backdrop = fg ? backdropOf(lc, base, node.id, rect) : null;
  if (!fg || !backdrop) {
    if (seenUnresolved.has(node.id)) return;
    seenUnresolved.add(node.id);
    found.push({
      id: findingId("contrast", node.id, "unresolved"),
      rule: "contrast",
      severity: "info",
      nodeId: node.id,
      pageId: lc.input.pageId,
      message: `Contrast of ${nodeLabel(node)} was not checked: the text or what is behind it is an image, a style or a blend mode.`,
    });
    return;
  }
  const large = isLargeText(node.fontSize ?? 16, node.fontWeight);
  const need = requiredRatio(large);
  const worst = worstRatio(fg.colors, backdrop.samples);
  if (worst.ratio + EPS >= need) return;
  const soft = fg.gradient || backdrop.gradient;
  found.push({
    id: findingId("contrast", node.id),
    rule: "contrast",
    severity: soft ? "info" : "error",
    nodeId: node.id,
    pageId: lc.input.pageId,
    message: `Text ${nodeLabel(node)} has contrast ${formatRatio(worst.ratio, need)}:1 (${toHex(worst.fg)} on ${toHex(worst.bg)}); ${large ? "large text" : "text"} needs ${need}:1.`,
    detail: soft ? "Worst gradient stop." : undefined,
    mode: mode || undefined,
  });
}

function strokeContrast(
  lc: LintContext,
  node: FlatSceneNode,
  rect: Rect,
  base: ModeContext,
  mode: string,
  found: Finding[],
): void {
  if (!strokeIsDrawn(node)) return;
  const strokes = getRenderableStrokes(node);
  const top = strokes[strokes.length - 1];
  if (!top) return;
  const layer = paintLayer(lc, node, top, lc.effectiveModes(node.id, base));
  if (layer.kind !== "solid") return;
  const backdrop = backdropOf(lc, base, node.id, rect);
  if (!backdrop) return;
  const worst = worstRatio([layer.color], backdrop.samples);
  if (worst.ratio + EPS >= UI_RATIO) return;
  found.push({
    id: findingId("contrast", node.id, "stroke"),
    rule: "contrast",
    severity: backdrop.gradient ? "info" : "warning",
    nodeId: node.id,
    pageId: lc.input.pageId,
    message: `Stroke of ${nodeLabel(node)} has contrast ${formatRatio(worst.ratio, UI_RATIO)}:1 (${toHex(worst.fg)} on ${toHex(worst.bg)}); UI boundaries need ${UI_RATIO}:1.`,
    detail: "Non-text contrast (WCAG 1.4.11).",
    mode: mode || undefined,
  });
}
