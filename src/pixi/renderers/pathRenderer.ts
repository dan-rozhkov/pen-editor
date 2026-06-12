import { Graphics, GraphicsPath } from "pixi.js";
import { Container } from "pixi.js";
import type { LineCap, LineJoin } from "pixi.js";
import type { PathNode } from "@/types/scene";
import { getRenderableFills } from "@/utils/fillUtils";
import {
  getResolvedFill,
  getResolvedStroke,
  parseColor,
  parseAlpha,
  escapeXmlAttr,
} from "./colorHelpers";
import { buildPixiGradient, fillSolidPaint } from "./fillStrokeHelpers";

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
  const fillColor = getResolvedFill(node);
  const strokeColor = getResolvedStroke(node);

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

  // Check if compound path (multiple subpaths) - needs evenodd for proper hole rendering
  const isCompoundPath = (geometry.match(/[Mm]/g)?.length ?? 0) > 1;
  // Use evenodd for compound paths (PixiJS requires explicit fill-rule for holes)
  const effectiveFillRule = node.fillRule ?? (isCompoundPath ? "evenodd" : "nonzero");

  // Parse SVG path-data directly (geometry is "d" string, not full <svg> markup).
  try {
    // Explicit paint stack: render each visible layer via GraphicsPath, stacking
    // bottom-to-top. The SVG-parser fast path (which respects fill-rule for the
    // legacy single solid fill) is only used when `fills` is NOT set.
    if (node.fills) {
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

/**
 * Render an explicit paint stack onto a path Graphics. Each visible solid or
 * gradient layer (bottom-to-top) re-issues the geometry and fills it; per-layer
 * blend modes are NOT supported for paths (single Graphics) and image paints are
 * ignored here (paths don't carry image fills in practice). The topmost fill's
 * path is left available so the caller's stroke can reuse it.
 */
function drawPathFillStack(
  gfx: Graphics,
  node: PathNode,
  geometry: string,
  evenOdd: boolean,
): void {
  const fills = getRenderableFills(node).filter((p) => p.type !== "image");
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
