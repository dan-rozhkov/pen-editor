import { Graphics, GraphicsPath } from "pixi.js";
import { Container } from "pixi.js";
import type { PathNode } from "@/types/scene";
import { getResolvedFill, getResolvedStroke, parseColor, parseAlpha, escapeXmlAttr } from "./colorHelpers";
import { buildPixiGradient } from "./fillStrokeHelpers";

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
    node.pathStroke !== prev.pathStroke ||
    node.gradientFill !== prev.gradientFill
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

  // Parse SVG path-data directly (node.geometry is "d" string, not full <svg> markup).
  try {
    const pathStroke = node.pathStroke;

    // Check if compound path (multiple subpaths) - needs evenodd for proper hole rendering
    const isCompoundPath = (node.geometry.match(/[Mm]/g)?.length ?? 0) > 1;

    // Use evenodd for compound paths (PixiJS requires explicit fill-rule for holes)
    const effectiveFillRule = node.fillRule ?? (isCompoundPath ? "evenodd" : "nonzero");

    // For solid fills, use SVG parser (respects fill-rule properly since PixiJS 8.8+)
    if (!node.gradientFill) {
      const fillAttr = fillColor ? ` fill="${escapeXmlAttr(fillColor)}"` : ` fill="none"`;
      const strokeAttrColor = pathStroke?.fill ?? strokeColor;
      const strokeAttr = strokeAttrColor
        ? ` stroke="${escapeXmlAttr(strokeAttrColor)}" stroke-width="${pathStroke?.thickness ?? node.strokeWidth ?? 1}" stroke-linecap="${pathStroke?.cap ?? "butt"}" stroke-linejoin="${pathStroke?.join ?? "miter"}"`
        : ` stroke="none"`;
      const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg"><path d="${escapeXmlAttr(node.geometry)}" fill-rule="${effectiveFillRule}"${fillAttr}${strokeAttr}/></svg>`;

      gfx.svg(svgMarkup);
      return;
    }

    // Gradient paths: use GraphicsPath (SVG parser doesn't support gradients)
    const path = new GraphicsPath(node.geometry, effectiveFillRule === "evenodd");
    gfx.path(path);
  } catch {
    // Fallback: draw a rect placeholder if SVG parsing fails
    gfx.rect(0, 0, node.width, node.height);
  }

  if (node.gradientFill) {
    const gradient = buildPixiGradient(node.gradientFill, node.width, node.height);
    gfx.fill(gradient);
  } else if (fillColor) {
    gfx.fill({ color: parseColor(fillColor), alpha: parseAlpha(fillColor) });
  }

  const pathStroke = node.pathStroke;
  if (pathStroke?.fill || strokeColor) {
    const sColor = pathStroke?.fill ?? strokeColor ?? "#000000";
    gfx.stroke({
      color: parseColor(sColor),
      width: pathStroke?.thickness ?? node.strokeWidth ?? 1,
      cap: (pathStroke?.cap as any) ?? "butt",
      join: (pathStroke?.join as any) ?? "miter",
    });
  }
}
