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
import { resolveMasking } from "@/lib/masks/maskResolution";
import { hasEffectiveUnderline, isSafeLinkHref, TEXT_LINK_COLOR } from "@/lib/textLink";
import { anchorsToSVGPath } from "@/utils/pathAnchors";
import { resolveTextPathDirection } from "@/utils/textPathLayout";
import { applyTextTransform } from "@/utils/textTransform";
import { buildEllipseArcGeometry, ellipseArcGeometryToSvgPath, hasCustomEllipseArc } from "@/lib/shapePath/ellipseArc";
import {
  buildCapMarker,
  buildEffectsFilter,
  buildFillLayers,
  buildStrokeLayers,
  buildStrokeWidthAttr,
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
  const strokeLayers = buildStrokeLayers(node, ctx);
  const strokeWidthAttr = buildStrokeWidthAttr(node, ctx, strokeLayers.length > 0);
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
    return fillLayersMarkup("path", `d="${d}"`, layers, strokeLayers, strokeWidthAttr);
  }

  const inset = strokeAlignInset(node);
  const x = inset;
  const y = inset;
  const w = Math.max(0, node.width - inset * 2);
  const h = Math.max(0, node.height - inset * 2);
  const r = Math.max(0, (node.cornerRadius ?? 0) - inset);
  const radiusAttr = r > 0 ? ` rx="${r}" ry="${r}"` : "";
  const baseAttrs = `x="${x}" y="${y}" width="${w}" height="${h}"${radiusAttr}`;
  return fillLayersMarkup("rect", baseAttrs, layers, strokeLayers, strokeWidthAttr);
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

/**
 * Build an SVG `<mask>` def from a masker node's own rendered markup and
 * register it in `ctx.defs`. SVG masks are luminance-alpha by default, which
 * conveniently covers both mask modes with one mechanism: a solid-fill
 * vector shape (rect/ellipse/path/polygon) masks with hard, opaque-white
 * edges, while a text or image node masks by its own rendered
 * alpha/luminance — matching `getMaskMode` in `@/lib/masks/maskResolution`
 * without needing separate code paths.
 */
function buildMaskDef(maskerId: string, ctx: SvgConversionContext): string {
  const id = nextSvgId("mask");
  const markup = convertNodeToSvg(maskerId, ctx, false);
  ctx.defs.push(`<mask id="${id}">${markup}</mask>`);
  return id;
}

/**
 * Render a container's children applying Figma-style sibling masking (see
 * `resolveMasking`): a masker node is not rendered as normal content (only
 * used to build its `<mask>` def), and every sibling it clips is wrapped in
 * `<g mask="url(#...)">`. Siblings covered by the same masker share one
 * `<mask>` def.
 */
function convertChildrenWithMasking(childIds: string[], ctx: SvgConversionContext): string {
  const { maskerIdBySiblingId, maskerIds } = resolveMasking(childIds, ctx.nodesById);
  const maskDefIdByMaskerId = new Map<string, string>();
  const parts: string[] = [];

  for (const childId of childIds) {
    if (maskerIds.has(childId)) continue;
    const svg = convertNodeToSvg(childId, ctx, false);
    const maskerId = maskerIdBySiblingId.get(childId);
    if (!maskerId) {
      parts.push(svg);
      continue;
    }
    let maskDefId = maskDefIdByMaskerId.get(maskerId);
    if (!maskDefId) {
      maskDefId = buildMaskDef(maskerId, ctx);
      maskDefIdByMaskerId.set(maskerId, maskDefId);
    }
    parts.push(`<g mask="url(#${maskDefId})">${svg}</g>`);
  }

  return parts.join("");
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
  const childrenSvg = convertChildrenWithMasking(childIds, ctx);
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
  const childrenSvg = convertChildrenWithMasking(childIds, ctx);
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
  const strokeLayers = buildStrokeLayers(node, ctx);
  const strokeWidthAttr = buildStrokeWidthAttr(node, ctx, strokeLayers.length > 0);

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
    const shape = fillLayersMarkup("path", `d="${d}"`, layers, strokeLayers, strokeWidthAttr);
    return `<g ${attrs}>${shape}</g>`;
  }

  const inset = strokeAlignInset(node);
  const cx = node.width / 2;
  const cy = node.height / 2;
  const rx = Math.max(0, node.width / 2 - inset);
  const ry = Math.max(0, node.height / 2 - inset);
  const shape = fillLayersMarkup(
    "ellipse",
    `cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"`,
    layers,
    strokeLayers,
    strokeWidthAttr,
  );
  return `<g ${attrs}>${shape}</g>`;
}

/**
 * Text-on-a-path: native SVG `<textPath>` gets this essentially for free — a
 * browser lays glyphs along the referenced `<path>` itself (tangent rotation
 * included), and per the `<textPath>` spec any glyph starting past the
 * path's end is simply not rendered, exactly matching the Pixi renderer's
 * overflow policy (`@/utils/textPathLayout`) with zero extra clipping logic.
 * This is the one export format that reaches pixel-for-pixel fidelity with
 * the canvas (see the task spec).
 *
 * `side`/`flip` have no direct `<textPath>` equivalent with reliable browser
 * support, so both are approximated structurally instead of via the
 * (poorly-supported) SVG2 `side` attribute:
 * - `side`: 'left' (text above the path, ascenders extending up from the
 *   baseline-on-path — the native `<textPath>` default) needs no extra
 *   attribute; 'right' (text below the path) uses `dominant-baseline="hanging"`
 *   to hang the glyph's top, not its baseline, from the path — matching the
 *   Pixi renderer's anchor-flip for the same case.
 * - `flip`: reverses which direction glyphs read along the curve. There's no
 *   "reverse textPath direction" attribute, so the `<path>` itself is
 *   authored backward instead — reversing the path also flips its tangent
 *   direction everywhere. `startOffset` is remapped (`1 - startOffset`) so
 *   the glyphs still start from the same point on the curve the user picked
 *   before the path was reversed. The reverse+remap is computed by
 *   `resolveTextPathDirection` (`@/utils/textPathLayout`), the same helper
 *   the Pixi renderer's per-glyph layout uses — a single definition of
 *   `flip` shared by both, so they can't drift the way they did before (the
 *   Pixi side used to just add PI to each glyph's angle without reversing
 *   the advance order, which mirrors the text in place rather than flipping
 *   its reading direction).
 */
function convertTextOnPathToSvg(
  node: TextNode,
  ctx: SvgConversionContext,
  isRoot: boolean,
  color: string,
  fontSize: number,
  fontFamily: string,
  fontWeightAttr: string,
  fontStyleAttr: string,
  decorationAttr: string,
): string {
  const tp = node.textPath!;
  const attrs = commonGroupAttrs(node, null, isRoot);
  const flip = !!tp.flip;
  const effectiveSide: "left" | "right" = flip ? (tp.side === "left" ? "right" : "left") : tp.side;
  const { points, closed, startOffset: startOffsetFrac } = resolveTextPathDirection(tp);
  const clampedOffset = Math.max(0, Math.min(1, startOffsetFrac));

  const d = anchorsToSVGPath(points, closed);
  const pathId = nextSvgId("textpath");
  ctx.defs.push(`<path id="${pathId}" d="${escapeXml(d)}" fill="none"/>`);

  const baselineAttr = effectiveSide === "right" ? ` dominant-baseline="hanging"` : "";
  const text = escapeXml(applyTextTransform(node.text, node.textTransform));

  const g = `<g ${attrs}><text font-family="${escapeXml(fontFamily)}" font-size="${fontSize}" fill="${color}"${fontWeightAttr}${fontStyleAttr}${decorationAttr}${baselineAttr}><textPath href="#${pathId}" startOffset="${(clampedOffset * 100).toFixed(3)}%">${text}</textPath></text></g>`;
  if (node.link && isSafeLinkHref(node.link.url)) {
    return `<a href="${escapeXml(node.link.url)}" target="_blank" rel="noopener">${g}</a>`;
  }
  return g;
}

function convertTextToSvg(node: TextNode, ctx: SvgConversionContext, isRoot: boolean): string {
  const attrs = commonGroupAttrs(node, null, isRoot);
  const primary = getPrimarySolidPaint(node);
  const color = primary
    ? applyOpacity(primary.color, primary.opacity)
    : node.fill
      ? applyOpacity(node.fill, node.fillOpacity)
      : // A linked node with no resolvable color of its own gets the default
        // link color, matching the canvas render and HTML export.
        node.link
        ? TEXT_LINK_COLOR
        : "#000000";

  const fontSize = node.fontSize ?? 16;
  const fontFamily = node.fontFamily ?? "sans-serif";
  const fontWeightAttr =
    node.fontWeight && node.fontWeight !== "normal" ? ` font-weight="${node.fontWeight}"` : "";
  const fontStyleAttr = node.fontStyle === "italic" ? ` font-style="italic"` : "";
  const decorations: string[] = [];
  if (hasEffectiveUnderline(node)) decorations.push("underline");
  if (node.strikethrough) decorations.push("line-through");
  const decorationAttr = decorations.length > 0 ? ` text-decoration="${decorations.join(" ")}"` : "";

  if (node.textPath) {
    return convertTextOnPathToSvg(
      node,
      ctx,
      isRoot,
      color,
      fontSize,
      fontFamily,
      fontWeightAttr,
      fontStyleAttr,
      decorationAttr,
    );
  }

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

  const g = `<g ${attrs}><text font-family="${escapeXml(fontFamily)}" font-size="${fontSize}" fill="${color}" text-anchor="${textAnchor}"${fontWeightAttr}${fontStyleAttr}${decorationAttr}>${tspans}</text></g>`;
  // Wrap in an SVG anchor when the node is a link with a safe URL, matching
  // the HTML export's clickable `<a>` (skip unsafe schemes like javascript:).
  if (node.link && isSafeLinkHref(node.link.url)) {
    return `<a href="${escapeXml(node.link.url)}" target="_blank" rel="noopener">${g}</a>`;
  }
  return g;
}

function convertPathToSvg(node: PathNode, ctx: SvgConversionContext, isRoot: boolean): string {
  const filterId = buildEffectsFilter(node, ctx);
  const attrs = commonGroupAttrs(node, filterId, isRoot);
  const fillRule = node.fillRule ?? "nonzero";

  // `strokes`/legacy `stroke` (the paint-stack model, potentially a
  // gradient or multiple paints) takes priority over `pathStroke` (path-only
  // legacy model, solid color only) when set — mirrors `getStrokes()`'s
  // fallback order. `pathStroke` still wins when neither is set, carrying
  // its own join/cap fields that have no `strokes`-model equivalent.
  const strokeLayers = node.strokes || node.stroke ? buildStrokeLayers(node, ctx) : [];
  let strokeAttr = "";
  let shapeEls: string;
  if (strokeLayers.length === 0 && node.pathStroke?.fill) {
    const strokeColor = applyOpacity(node.pathStroke.fill, node.strokeOpacity);
    const strokeWidth = node.pathStroke.thickness ?? 1;
    const join = node.pathStroke.join ?? "miter";
    const cap = node.pathStroke.cap ?? "butt";
    strokeAttr = ` stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linejoin="${join}" stroke-linecap="${cap}"`;
    const layers = buildFillLayers(node, ctx);
    shapeEls =
      layers.length === 0
        ? `<path d="${node.geometry}" fill="none" fill-rule="${fillRule}"${strokeAttr}/>`
        : layers
            .map((l, i) => {
              const opacityAttr = l.opacity != null && l.opacity !== 1 ? ` fill-opacity="${l.opacity}"` : "";
              const stroke = i === layers.length - 1 ? strokeAttr : "";
              return `<path d="${node.geometry}" fill="${l.fill}"${opacityAttr} fill-rule="${fillRule}"${stroke}/>`;
            })
            .join("");
  } else {
    const strokeWidthAttr = buildStrokeWidthAttr(node, ctx, strokeLayers.length > 0);
    const layers = buildFillLayers(node, ctx);
    shapeEls = fillLayersMarkup("path", `d="${node.geometry}" fill-rule="${fillRule}"`, layers, strokeLayers, strokeWidthAttr);
  }
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
  const strokeLayers = buildStrokeLayers(node, ctx);
  const strokeWidthAttr = buildStrokeWidthAttr(node, ctx, strokeLayers.length > 0);
  const layers = buildFillLayers(node, ctx);
  const shape = fillLayersMarkup("polygon", `points="${pointsStr}"`, layers, strokeLayers, strokeWidthAttr);
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
