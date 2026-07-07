import type {
  ConnectorNode,
  EllipseNode,
  FlatFrameNode,
  FlatGroupNode,
  FlatSceneNode,
  LineNode,
  PathNode,
  PolygonNode,
  RectNode,
  TextNode,
} from "@/types/scene";
import { applyOpacity } from "@/utils/colorUtils";
import { getPrimarySolidPaint } from "@/utils/fillUtils";
import { pointsAttr } from "@/utils/lineCapUtils";
import { buildEllipseArcGeometry, ellipseArcGeometryToSvgPath, hasCustomEllipseArc } from "@/lib/shapePath/ellipseArc";
import {
  buildCapMarker,
  buildEffectsFilter,
  buildFillLayers,
  buildStrokeAttr,
  escapeXml,
  fillLayersMarkup,
  hasNonUniformCornerRadius,
  nextSvgId,
  roundedRectPath,
  strokeAlignInset,
  type SvgConversionContext,
} from "./shapeStyles";

function nodeLabel(node: FlatSceneNode): string {
  return node.name ?? node.id;
}

/**
 * Build the `transform`/`opacity`/`filter` attribute string shared by every
 * node's wrapping `<g>`. The root node renders at the origin of the exported
 * SVG canvas (no translate); every other node translates by its own x/y,
 * which are stored relative to the parent (matches `convertNode.ts` in
 * designToHtml and the flat scene graph's coordinate convention).
 */
function commonGroupAttrs(node: FlatSceneNode, filterId: string | null, isRoot: boolean): string {
  const transforms: string[] = [];
  if (!isRoot) {
    transforms.push(`translate(${node.x} ${node.y})`);
  }
  if (node.rotation) {
    const cx = node.width / 2;
    const cy = node.height / 2;
    transforms.push(`rotate(${node.rotation} ${cx} ${cy})`);
  }
  if (node.flipX || node.flipY) {
    const sx = node.flipX ? -1 : 1;
    const sy = node.flipY ? -1 : 1;
    const cx = node.width / 2;
    const cy = node.height / 2;
    transforms.push(`translate(${cx} ${cy}) scale(${sx} ${sy}) translate(${-cx} ${-cy})`);
  }

  const attrs: string[] = [];
  if (transforms.length > 0) {
    attrs.push(`transform="${transforms.join(" ")}"`);
  }
  if (node.opacity !== undefined && node.opacity < 1) {
    attrs.push(`opacity="${node.opacity}"`);
  }
  if (filterId) {
    attrs.push(`filter="url(#${filterId})"`);
  }
  return attrs.join(" ");
}

/** Fill + stroke + corner-radius markup shared by frame backgrounds and rect nodes. */
function renderRectLikeShape(node: FlatFrameNode | RectNode, ctx: SvgConversionContext): string {
  const layers = buildFillLayers(node, ctx);
  const strokeAttr = buildStrokeAttr(node, ctx);
  const pcr = node.cornerRadiusPerCorner;
  const smoothing = node.cornerSmoothing;

  if (hasNonUniformCornerRadius(pcr) || (smoothing && (hasNonUniformCornerRadius(pcr) || node.cornerRadius))) {
    const d = roundedRectPath(
      0,
      0,
      node.width,
      node.height,
      {
        tl: pcr?.topLeft ?? node.cornerRadius ?? 0,
        tr: pcr?.topRight ?? node.cornerRadius ?? 0,
        br: pcr?.bottomRight ?? node.cornerRadius ?? 0,
        bl: pcr?.bottomLeft ?? node.cornerRadius ?? 0,
      },
      smoothing,
    );
    return fillLayersMarkup("path", `d="${d}"`, layers, strokeAttr);
  }

  const inset = strokeAlignInset(node);
  const x = inset;
  const y = inset;
  const w = Math.max(0, node.width - inset * 2);
  const h = Math.max(0, node.height - inset * 2);
  const r = Math.max(0, (node.cornerRadius ?? 0) - inset);
  const radiusAttr = r > 0 ? ` rx="${r}" ry="${r}"` : "";
  const baseAttrs = `x="${x}" y="${y}" width="${w}" height="${h}"${radiusAttr}`;
  return fillLayersMarkup("rect", baseAttrs, layers, strokeAttr);
}

function buildClipPathForFrame(node: FlatFrameNode, ctx: SvgConversionContext): string {
  const id = nextSvgId("clip");
  const pcr = node.cornerRadiusPerCorner;
  const smoothing = node.cornerSmoothing;
  const usesPath = hasNonUniformCornerRadius(pcr) || (smoothing && (hasNonUniformCornerRadius(pcr) || node.cornerRadius));
  const shape = usesPath
    ? `<path d="${roundedRectPath(
        0,
        0,
        node.width,
        node.height,
        {
          tl: pcr?.topLeft ?? node.cornerRadius ?? 0,
          tr: pcr?.topRight ?? node.cornerRadius ?? 0,
          br: pcr?.bottomRight ?? node.cornerRadius ?? 0,
          bl: pcr?.bottomLeft ?? node.cornerRadius ?? 0,
        },
        smoothing,
      )}"/>`
    : node.cornerRadius
      ? `<rect width="${node.width}" height="${node.height}" rx="${node.cornerRadius}" ry="${node.cornerRadius}"/>`
      : `<rect width="${node.width}" height="${node.height}"/>`;
  ctx.defs.push(`<clipPath id="${id}">${shape}</clipPath>`);
  return id;
}

function convertFrameToSvg(
  node: FlatFrameNode,
  nodeId: string,
  ctx: SvgConversionContext,
  isRoot: boolean,
): string {
  const filterId = buildEffectsFilter(node, ctx);
  const attrs = commonGroupAttrs(node, filterId, isRoot);
  const background = renderRectLikeShape(node, ctx);
  const childIds = ctx.childrenById[nodeId] ?? [];
  const childrenSvg = childIds.map((childId) => convertNodeToSvg(childId, ctx, false)).join("");
  const clipAttr = node.clip ? ` clip-path="url(#${buildClipPathForFrame(node, ctx)})"` : "";
  return `<g ${attrs}${clipAttr}>${background}${childrenSvg}</g>`;
}

function convertGroupToSvg(
  node: FlatGroupNode,
  nodeId: string,
  ctx: SvgConversionContext,
  isRoot: boolean,
): string {
  const attrs = commonGroupAttrs(node, null, isRoot);
  const childIds = ctx.childrenById[nodeId] ?? [];
  const childrenSvg = childIds.map((childId) => convertNodeToSvg(childId, ctx, false)).join("");
  let clipAttr = "";
  if (node.clipGeometry) {
    const id = nextSvgId("clip");
    ctx.defs.push(`<clipPath id="${id}"><path d="${node.clipGeometry}"/></clipPath>`);
    clipAttr = ` clip-path="url(#${id})"`;
  }
  return `<g ${attrs}${clipAttr}>${childrenSvg}</g>`;
}

function convertRectToSvg(node: RectNode, ctx: SvgConversionContext, isRoot: boolean): string {
  const filterId = buildEffectsFilter(node, ctx);
  const attrs = commonGroupAttrs(node, filterId, isRoot);
  return `<g ${attrs}>${renderRectLikeShape(node, ctx)}</g>`;
}

function convertEllipseToSvg(node: EllipseNode, ctx: SvgConversionContext, isRoot: boolean): string {
  const filterId = buildEffectsFilter(node, ctx);
  const attrs = commonGroupAttrs(node, filterId, isRoot);
  const layers = buildFillLayers(node, ctx);
  const strokeAttr = buildStrokeAttr(node, ctx);

  const arcParams = {
    startAngle: node.startAngle,
    sweepAngle: node.sweepAngle,
    innerRadiusRatio: node.innerRadiusRatio,
  };
  if (hasCustomEllipseArc(arcParams)) {
    if (node.strokeAlign && node.strokeAlign !== "center" && node.stroke && node.strokeWidth) {
      ctx.warnings.push(
        `Stroke align "${node.strokeAlign}" on arc/donut ellipse "${nodeLabel(node)}" is approximated as centered in SVG export.`,
      );
    }
    const geometry = buildEllipseArcGeometry(node.width, node.height, arcParams);
    const d = ellipseArcGeometryToSvgPath(geometry);
    const shape = fillLayersMarkup("path", `d="${d}"`, layers, strokeAttr);
    return `<g ${attrs}>${shape}</g>`;
  }

  const inset = strokeAlignInset(node);
  const cx = node.width / 2;
  const cy = node.height / 2;
  const rx = Math.max(0, node.width / 2 - inset);
  const ry = Math.max(0, node.height / 2 - inset);
  const shape = fillLayersMarkup("ellipse", `cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"`, layers, strokeAttr);
  return `<g ${attrs}>${shape}</g>`;
}

function convertTextToSvg(node: TextNode, _ctx: SvgConversionContext, isRoot: boolean): string {
  const attrs = commonGroupAttrs(node, null, isRoot);
  const primary = getPrimarySolidPaint(node);
  const color = primary
    ? applyOpacity(primary.color, primary.opacity)
    : node.fill
      ? applyOpacity(node.fill, node.fillOpacity)
      : "#000000";

  const fontSize = node.fontSize ?? 16;
  const fontFamily = node.fontFamily ?? "sans-serif";
  const fontWeightAttr =
    node.fontWeight && node.fontWeight !== "normal" ? ` font-weight="${node.fontWeight}"` : "";
  const fontStyleAttr = node.fontStyle === "italic" ? ` font-style="italic"` : "";
  const decorations: string[] = [];
  if (node.underline) decorations.push("underline");
  if (node.strikethrough) decorations.push("line-through");
  const decorationAttr = decorations.length > 0 ? ` text-decoration="${decorations.join(" ")}"` : "";

  const textAnchor = node.textAlign === "center" ? "middle" : node.textAlign === "right" ? "end" : "start";
  const anchorX = node.textAlign === "center" ? node.width / 2 : node.textAlign === "right" ? node.width : 0;
  const lineHeightPx = (node.lineHeight ?? 1.2) * fontSize;
  // Approximate the font's ascent as the font size itself (no real metrics
  // available outside a canvas/DOM measurement context).
  const baseline = fontSize;

  const tspans = node.text
    .split("\n")
    .map((line, i) => `<tspan x="${anchorX}" y="${baseline + i * lineHeightPx}">${escapeXml(line)}</tspan>`)
    .join("");

  return `<g ${attrs}><text font-family="${escapeXml(fontFamily)}" font-size="${fontSize}" fill="${color}" text-anchor="${textAnchor}"${fontWeightAttr}${fontStyleAttr}${decorationAttr}>${tspans}</text></g>`;
}

function convertPathToSvg(node: PathNode, ctx: SvgConversionContext, isRoot: boolean): string {
  const filterId = buildEffectsFilter(node, ctx);
  const attrs = commonGroupAttrs(node, filterId, isRoot);
  const fillRule = node.fillRule ?? "nonzero";

  let strokeAttr = "";
  if (node.pathStroke?.fill) {
    const strokeColor = applyOpacity(node.pathStroke.fill, node.strokeOpacity);
    const strokeWidth = node.pathStroke.thickness ?? 1;
    const join = node.pathStroke.join ?? "miter";
    const cap = node.pathStroke.cap ?? "butt";
    strokeAttr = ` stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linejoin="${join}" stroke-linecap="${cap}"`;
  } else {
    strokeAttr = buildStrokeAttr(node, ctx);
  }

  const layers = buildFillLayers(node, ctx);
  const shapeEls =
    layers.length === 0
      ? `<path d="${node.geometry}" fill="none" fill-rule="${fillRule}"${strokeAttr}/>`
      : layers
          .map((l, i) => {
            const opacityAttr = l.opacity != null && l.opacity !== 1 ? ` fill-opacity="${l.opacity}"` : "";
            const stroke = i === layers.length - 1 ? strokeAttr : "";
            return `<path d="${node.geometry}" fill="${l.fill}"${opacityAttr} fill-rule="${fillRule}"${stroke}/>`;
          })
          .join("");
  return `<g ${attrs}>${shapeEls}</g>`;
}

function convertLineToSvg(node: LineNode, ctx: SvgConversionContext, isRoot: boolean): string {
  const attrs = commonGroupAttrs(node, null, isRoot);
  const [x1, y1, x2, y2] = node.points;
  const strokeColor = node.stroke ? applyOpacity(node.stroke, node.strokeOpacity) : "#000000";
  const strokeWidth = node.strokeWidth ?? 1;

  const startMarkerId = buildCapMarker(node.startCap ?? "none", strokeWidth, strokeColor, "auto-start-reverse", ctx);
  const endMarkerId = buildCapMarker(node.endCap ?? "none", strokeWidth, strokeColor, "auto", ctx);
  const markerAttrs =
    (startMarkerId ? ` marker-start="url(#${startMarkerId})"` : "") +
    (endMarkerId ? ` marker-end="url(#${endMarkerId})"` : "");

  return `<g ${attrs}><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${strokeColor}" stroke-width="${strokeWidth}"${markerAttrs}/></g>`;
}

function convertConnectorToSvg(node: ConnectorNode, _ctx: SvgConversionContext, isRoot: boolean): string {
  const attrs = commonGroupAttrs(node, null, isRoot);
  const [x1, y1, x2, y2] = node.points;
  const strokeColor = node.stroke ? applyOpacity(node.stroke, node.strokeOpacity) : "#000000";
  const strokeWidth = node.strokeWidth ?? 1;
  return `<g ${attrs}><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${strokeColor}" stroke-width="${strokeWidth}"/></g>`;
}

function convertPolygonToSvg(node: PolygonNode, ctx: SvgConversionContext, isRoot: boolean): string {
  const filterId = buildEffectsFilter(node, ctx);
  const attrs = commonGroupAttrs(node, filterId, isRoot);
  const pointsStr = pointsAttr(node.points);
  const strokeAttr = buildStrokeAttr(node, ctx);
  const layers = buildFillLayers(node, ctx);
  const shape = fillLayersMarkup("polygon", `points="${pointsStr}"`, layers, strokeAttr);
  return `<g ${attrs}>${shape}</g>`;
}

/**
 * Fallback for content that cannot be represented as flat SVG (embeds,
 * component instances). Renders a labeled dashed placeholder so the exported
 * layout keeps the node's footprint, and records a warning for the caller to
 * surface to the user.
 */
function convertPlaceholderToSvg(node: FlatSceneNode, _ctx: SvgConversionContext, isRoot: boolean): string {
  const attrs = commonGroupAttrs(node, null, isRoot);
  return `<g ${attrs}><rect width="${node.width}" height="${node.height}" fill="none" stroke="#999999" stroke-width="1" stroke-dasharray="4 4"/></g>`;
}

/**
 * Convert a single scene node (and its descendants) to SVG markup.
 * Mirrors `convertNodeToHtml` in `designToHtml/convertNode.ts`: works
 * directly against the flat store data, recursing through `childrenById`.
 */
export function convertNodeToSvg(nodeId: string, ctx: SvgConversionContext, isRoot: boolean): string {
  const node = ctx.nodesById[nodeId];
  if (!node) return "";
  if (node.visible === false || node.enabled === false) return "";

  if (node.shader) {
    ctx.warnings.push(
      `Shader on node "${nodeLabel(node)}" is not supported in SVG export and was skipped.`,
    );
  }

  switch (node.type) {
    case "frame":
      return convertFrameToSvg(node as FlatFrameNode, nodeId, ctx, isRoot);
    case "group":
      return convertGroupToSvg(node as FlatGroupNode, nodeId, ctx, isRoot);
    case "rect":
      return convertRectToSvg(node as RectNode, ctx, isRoot);
    case "ellipse":
      return convertEllipseToSvg(node as EllipseNode, ctx, isRoot);
    case "text":
      return convertTextToSvg(node as TextNode, ctx, isRoot);
    case "path":
      return convertPathToSvg(node as PathNode, ctx, isRoot);
    case "line":
      return convertLineToSvg(node as LineNode, ctx, isRoot);
    case "polygon":
      return convertPolygonToSvg(node as PolygonNode, ctx, isRoot);
    case "connector":
      return convertConnectorToSvg(node as ConnectorNode, ctx, isRoot);
    case "embed":
      ctx.warnings.push(
        `Embed node "${nodeLabel(node)}" cannot be rendered in SVG export and was replaced with a placeholder.`,
      );
      return convertPlaceholderToSvg(node, ctx, isRoot);
    case "ref":
      ctx.warnings.push(
        `Component instance "${nodeLabel(node)}" cannot be rendered in SVG export and was replaced with a placeholder.`,
      );
      return convertPlaceholderToSvg(node, ctx, isRoot);
    default:
      return "";
  }
}
