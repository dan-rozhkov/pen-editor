import { Graphics, GraphicsPath } from "pixi.js";
import { Container } from "pixi.js";
import type { LineCap, LineJoin, Polygon } from "pixi.js";
import type { PathNode } from "@/types/scene";
import {
  getResolvedFill,
  getResolvedRenderableFills,
  getResolvedStroke,
  parseColor,
  parseAlpha,
  escapeXmlAttr,
} from "./colorHelpers";
import { buildPixiGradient, fillSolidPaint } from "./fillStrokeHelpers";
import { isOutlineRenderMode, strokeOutlinePath } from "./outlineHelpers";

/**
 * Normalize compact SVG arc flag notation that PixiJS can't parse.
 * SVG spec allows arc flags (0 or 1) to omit separators, e.g. "a1 1 0 01-1 1".
 * This function inserts spaces: "a1 1 0 0 1 -1 1".
 */
function normalizeArcFlags(d: string): string {
  return d.replace(
    /[aA][^aAmMzZlLhHvVcCsSqQtT]*/g,
    (arcSegment) => {
      const cmd = arcSegment[0];
      const rest = arcSegment.slice(1);
      const result: string[] = [cmd];
      let i = 0;
      let paramIdx = 0;
      while (i < rest.length) {
        if (/[\s,]/.test(rest[i])) {
          result.push(rest[i]);
          i++;
          continue;
        }
        const localIdx = paramIdx % 7;
        if ((localIdx === 3 || localIdx === 4) && (rest[i] === '0' || rest[i] === '1')) {
          result.push(rest[i]);
          i++;
          paramIdx++;
          if (i < rest.length && !/[\s,]/.test(rest[i])) {
            result.push(' ');
          }
        } else {
          const numMatch = rest.slice(i).match(/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/);
          if (numMatch) {
            result.push(numMatch[0]);
            i += numMatch[0].length;
            paramIdx++;
          } else {
            result.push(rest[i]);
            i++;
          }
        }
      }
      return result.join('');
    },
  );
}

function colorToHex(color: string): string {
  const n = parseColor(color);
  if (!Number.isFinite(n)) return "#000000";
  return `#${Math.max(0, Math.min(0xffffff, n)).toString(16).padStart(6, "0")}`;
}

interface NonzeroFillGeometry {
  regions: Array<{
    outer: string;
    holes: string[];
  }>;
}

interface NonzeroRing {
  path: string;
  polygon: Polygon;
  boundsArea: number;
  parent: number | null;
  winding: number;
}

/**
 * PixiJS 8 only discovers compound-path holes for evenodd fills. For a real
 * SVG nonzero fill, derive the boundaries where the accumulated winding
 * changes between zero and non-zero, preserving same-winding nested contours.
 */
function resolveNonzeroFillGeometry(geometry: string): NonzeroFillGeometry | null {
  // Figma's decoded geometry is absolute. A later relative `m` depends on the
  // previous subpath's endpoint, so keep Pixi's native fallback for that form.
  if (geometry.includes("m")) return null;
  const subpaths = geometry.split(/(?=M)/).filter((part) => part.trim().length > 0);
  if (subpaths.length < 2) return null;

  try {
    const rings: NonzeroRing[] = subpaths.map((path) => {
      const primitives = new GraphicsPath(path, false).shapePath.shapePrimitives;
      if (primitives.length !== 1 || primitives[0].shape.type !== "polygon") {
        throw new Error("Unsupported compound path primitive");
      }
      const polygon = primitives[0].shape as Polygon;
      if (!polygon.closePath) throw new Error("Open compound path");
      const bounds = polygon.getBounds();
      return {
        path,
        polygon,
        boundsArea: bounds.width * bounds.height,
        parent: null,
        winding: polygon.isClockwise() ? 1 : -1,
      };
    });

    for (let childIndex = 0; childIndex < rings.length; childIndex++) {
      const child = rings[childIndex];
      let parentIndex: number | null = null;
      for (let candidateIndex = 0; candidateIndex < rings.length; candidateIndex++) {
        if (candidateIndex === childIndex) continue;
        const candidate = rings[candidateIndex];
        if (
          candidate.boundsArea <= child.boundsArea ||
          !candidate.polygon.containsPolygon(child.polygon)
        ) {
          continue;
        }
        if (parentIndex == null || candidate.boundsArea < rings[parentIndex].boundsArea) {
          parentIndex = candidateIndex;
        }
      }
      child.parent = parentIndex;
    }

    const windingInside = new Array<number | undefined>(rings.length);
    const resolveWindingInside = (index: number): number => {
      const cached = windingInside[index];
      if (cached != null) return cached;
      const parent = rings[index].parent;
      const outside = parent == null ? 0 : resolveWindingInside(parent);
      const inside = outside + rings[index].winding;
      windingInside[index] = inside;
      return inside;
    };

    const outerIndexes: number[] = [];
    const holeIndexes: number[] = [];
    for (let index = 0; index < rings.length; index++) {
      const parent = rings[index].parent;
      const outside = parent == null ? 0 : resolveWindingInside(parent);
      const inside = resolveWindingInside(index);
      if (outside === 0 && inside !== 0) outerIndexes.push(index);
      if (outside !== 0 && inside === 0) holeIndexes.push(index);
    }

    if (holeIndexes.length === 0 || outerIndexes.length === 0) return null;

    const outerIndexSet = new Set(outerIndexes);
    const regionByOuter = new Map(
      outerIndexes.map((index) => [index, { outer: rings[index].path, holes: [] as string[] }]),
    );
    for (const holeIndex of holeIndexes) {
      let ancestor = rings[holeIndex].parent;
      while (ancestor != null && !outerIndexSet.has(ancestor)) {
        ancestor = rings[ancestor].parent;
      }
      if (ancestor == null) throw new Error("Nonzero hole has no containing outer boundary");
      regionByOuter.get(ancestor)?.holes.push(rings[holeIndex].path);
    }

    return { regions: outerIndexes.map((index) => regionByOuter.get(index)!) };
  } catch {
    // Unsupported/malformed path: retain the declared nonzero behaviour.
    return null;
  }
}

function drawNonzeroFill(
  gfx: Graphics,
  geometry: NonzeroFillGeometry,
  applyFill: () => void,
): void {
  // Pixi associates `cut()` with the most recently filled geometry. Keep each
  // disconnected outer and its holes in a separate fill instruction; otherwise
  // a hole belonging to an earlier outer can be attached to the last outer and
  // remain visibly filled (for example, the first head in a two-person icon).
  for (const region of geometry.regions) {
    gfx.path(new GraphicsPath(region.outer, false));
    applyFill();
    for (const hole of region.holes) {
      gfx.path(new GraphicsPath(hole, false));
      gfx.cut();
    }
  }
}

export function createPathContainer(node: PathNode): Container {
  const container = new Container();
  const gfx = new Graphics();
  gfx.label = "path-gfx";
  drawPath(gfx, node);
  container.addChild(gfx);
  return container;
}

export function updatePathContainer(
  container: Container,
  node: PathNode,
  prev: PathNode,
): void {
  if (
    node.geometry !== prev.geometry ||
    node.width !== prev.width ||
    node.height !== prev.height ||
    node.fill !== prev.fill ||
    node.fillBinding !== prev.fillBinding ||
    node.fillOpacity !== prev.fillOpacity ||
    node.stroke !== prev.stroke ||
    node.strokeBinding !== prev.strokeBinding ||
    node.strokeOpacity !== prev.strokeOpacity ||
    node.strokeWidth !== prev.strokeWidth ||
    node.strokeAlign !== prev.strokeAlign ||
    node.pathStroke !== prev.pathStroke ||
    node.gradientFill !== prev.gradientFill ||
    node.fillRule !== prev.fillRule ||
    node.fills !== prev.fills
  ) {
    const gfx = container.getChildByLabel("path-gfx") as Graphics;
    if (gfx) {
      gfx.clear();
      drawPath(gfx, node);
    }
  }
}

export function drawPath(gfx: Graphics, node: PathNode): void {
  if (!node.geometry) return;

  // Normalize compact arc flag notation that PixiJS can't parse
  const geometry = normalizeArcFlags(node.geometry);

  // Reset transform first to avoid carrying stale values across redraws.
  gfx.scale.set(1, 1);
  gfx.position.set(0, 0);

  // Apply scale transform if geometry has bounds different from node size
  const gb = node.geometryBounds;
  if (gb) {
    const scaleX = node.width / gb.width;
    const scaleY = node.height / gb.height;
    gfx.scale.set(scaleX, scaleY);
    gfx.position.set(-gb.x * scaleX, -gb.y * scaleY);
  }

  // Outline mode: stroke the raw path geometry only — no fill stack, no
  // gradient, no node-owned stroke color/width.
  if (isOutlineRenderMode()) {
    try {
      gfx.path(new GraphicsPath(geometry));
    } catch {
      gfx.rect(0, 0, node.width, node.height);
    }
    strokeOutlinePath(gfx);
    return;
  }

  const fillColor = getResolvedFill(node);
  const strokeColor = getResolvedStroke(node);

  // Check if compound path (multiple subpaths) - needs evenodd for proper hole rendering
  const isCompoundPath = (geometry.match(/[Mm]/g)?.length ?? 0) > 1;
  // Use evenodd for compound paths (PixiJS requires explicit fill-rule for holes)
  const effectiveFillRule = node.fillRule ?? (isCompoundPath ? "evenodd" : "nonzero");
  const nonzeroFillGeometry = effectiveFillRule === "nonzero"
    ? resolveNonzeroFillGeometry(geometry)
    : null;
  let restoreStrokePath = false;

  // Parse SVG path-data directly (geometry is "d" string, not full <svg> markup).
  try {
    if (nonzeroFillGeometry) {
      // Pixi's SVG parser does not implement nonzero winding holes. Render the
      // zero/non-zero boundaries explicitly, while retaining the source rule on
      // the SceneNode for SVG export and editing semantics.
      if (node.fills) {
        drawNonzeroPathFillStack(gfx, node, nonzeroFillGeometry);
      } else if (node.gradientFill) {
        const gradient = buildPixiGradient(node.gradientFill, node.width, node.height);
        drawNonzeroFill(gfx, nonzeroFillGeometry, () => gfx.fill(gradient));
      } else if (fillColor) {
        drawNonzeroFill(gfx, nonzeroFillGeometry, () => {
          gfx.fill({ color: parseColor(fillColor), alpha: parseAlpha(fillColor) });
        });
      }
      restoreStrokePath = true;
      // Explicit paint stack: render each visible layer via GraphicsPath, stacking
      // bottom-to-top. The SVG-parser fast path (which respects fill-rule for the
      // legacy single solid fill) is only used when `fills` is NOT set.
    } else if (node.fills) {
      drawPathFillStack(gfx, node, geometry, effectiveFillRule === "evenodd");
    } else {
      const pathStroke = node.pathStroke;
      // For solid fills, use SVG parser (respects fill-rule properly since PixiJS 8.8+)
      if (!node.gradientFill) {
        const fillAttr = fillColor
          ? ` fill="${colorToHex(fillColor)}" fill-opacity="${parseAlpha(fillColor)}"`
          : ` fill="none"`;
        const strokeAttrColor = pathStroke?.fill ?? strokeColor;
        const strokeAttr = strokeAttrColor
          ? ` stroke="${colorToHex(strokeAttrColor)}" stroke-opacity="${parseAlpha(strokeAttrColor)}" stroke-width="${pathStroke?.thickness ?? node.strokeWidth ?? 1}" stroke-linecap="${pathStroke?.cap ?? "butt"}" stroke-linejoin="${pathStroke?.join ?? "miter"}"`
          : ` stroke="none"`;
        const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg"><path d="${escapeXmlAttr(geometry)}" fill-rule="${effectiveFillRule}"${fillAttr}${strokeAttr}/></svg>`;

        gfx.svg(svgMarkup);
        return;
      }

      // Gradient paths: use GraphicsPath (SVG parser doesn't support gradients)
      const path = new GraphicsPath(geometry, effectiveFillRule === "evenodd");
      gfx.path(path);
      const gradient = buildPixiGradient(node.gradientFill, node.width, node.height);
      gfx.fill(gradient);
    }
  } catch {
    // Fallback: draw a rect placeholder if SVG parsing fails
    gfx.rect(0, 0, node.width, node.height);
  }

  const pathStroke = node.pathStroke;
  if (pathStroke?.fill || strokeColor) {
    if (restoreStrokePath) {
      gfx.path(new GraphicsPath(geometry, false));
    }
    const sColor = pathStroke?.fill ?? strokeColor ?? "#000000";
    const align = node.strokeAlign ?? 'center';
    const alignment = align === 'inside' ? 1 : align === 'outside' ? 0 : 0.5;
    // A path is always available here: `drawPathFillStack` lays one down even
    // when the stack has no fillable layer, and the legacy branches above
    // either return early or leave their fill's path reusable.
    gfx.stroke({
      color: parseColor(sColor),
      width: pathStroke?.thickness ?? node.strokeWidth ?? 1,
      cap: (pathStroke?.cap as LineCap | undefined) ?? "butt",
      join: (pathStroke?.join as LineJoin | undefined) ?? "miter",
      alignment,
    });
  }
}

function drawNonzeroPathFillStack(
  gfx: Graphics,
  node: PathNode,
  geometry: NonzeroFillGeometry,
): void {
  for (const paint of getResolvedRenderableFills(node)) {
    if (paint.type !== "gradient" && paint.type !== "solid") continue;
    drawNonzeroFill(gfx, geometry, () => {
      if (paint.type === "gradient") {
        const gradient = buildPixiGradient(paint.gradient, node.width, node.height);
        gfx.fill({ fill: gradient, alpha: paint.opacity ?? 1 });
      } else {
        fillSolidPaint(gfx, paint);
      }
    });
  }
}

/**
 * Render an explicit paint stack onto a path Graphics. Each visible solid or
 * gradient layer (bottom-to-top) re-issues the geometry and fills it; per-layer
 * blend modes are NOT supported for paths (single Graphics) and image/pattern
 * paints are skipped here — paths have no sprite-fill rendering path, so
 * silently dropping them (rather than half-rendering) is the safe fallback.
 * The topmost fill's path is left available so the caller's stroke can reuse it.
 */
function drawPathFillStack(
  gfx: Graphics,
  node: PathNode,
  geometry: string,
  evenOdd: boolean,
): void {
  const fills = getResolvedRenderableFills(node).filter(
    (p) => p.type !== "image" && p.type !== "pattern",
  );
  if (fills.length === 0) {
    // No fillable layer: still lay down the path so a stroke can use it.
    gfx.path(new GraphicsPath(geometry, evenOdd));
    return;
  }
  for (const paint of fills) {
    // blendMode intentionally unsupported for path fills (documented simplification)
    gfx.path(new GraphicsPath(geometry, evenOdd));
    if (paint.type === "gradient") {
      const gradient = buildPixiGradient(paint.gradient, node.width, node.height);
      gfx.fill({ fill: gradient, alpha: paint.opacity ?? 1 });
    } else if (paint.type === "solid") {
      fillSolidPaint(gfx, paint);
    }
  }
}
