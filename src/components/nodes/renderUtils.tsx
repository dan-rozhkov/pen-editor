import { Ellipse, Group, Image as KonvaImage, Line, Rect } from "react-konva";
import type {
  DescendantOverride,
  ImageFill,
  PerSideStroke,
  SceneNode,
  TextNode,
} from "@/types/scene";
import { useLoadImage } from "@/hooks/useLoadImage";
import { useSceneStore } from "@/store/sceneStore";
import { isDescendantOfFlat } from "@/utils/nodeUtils";
import {
  measureTextAutoSize,
  measureTextFixedWidthHeight,
} from "@/utils/textMeasure";

// Figma-style hover outline color
export const HOVER_OUTLINE_COLOR = "#0d99ff";
export const COMPONENT_HOVER_OUTLINE_COLOR = "#8B5CF6";

export function getHoverOutlineColor(nodeId: string): string {
  const { nodesById, parentById } = useSceneStore.getState();
  let currentId: string | null = nodeId;

  while (currentId) {
    const currentNode = nodesById[currentId];
    if (!currentNode) break;

    if (currentNode.type === "ref") {
      return COMPONENT_HOVER_OUTLINE_COLOR;
    }
    if (currentNode.type === "frame" && currentNode.reusable) {
      return COMPONENT_HOVER_OUTLINE_COLOR;
    }

    currentId = parentById[currentId] ?? null;
  }

  return HOVER_OUTLINE_COLOR;
}

interface SelectionOutlineProps {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  flipX?: boolean;
  flipY?: boolean;
  shape?: "rect" | "ellipse";
  stroke?: string;
  strokeWidth?: number;
  cornerRadius?: number;
  dash?: number[];
  listening?: boolean;
}

export function SelectionOutline({
  x,
  y,
  width,
  height,
  rotation = 0,
  flipX = false,
  flipY = false,
  shape = "rect",
  stroke = "#8B5CF6",
  strokeWidth = 2,
  cornerRadius,
  dash,
  listening = false,
}: SelectionOutlineProps) {
  const commonProps = {
    stroke,
    strokeWidth,
    dash,
    listening,
  };

  if (shape === "ellipse") {
    return (
      <Ellipse
        x={x + width / 2}
        y={y + height / 2}
        radiusX={width / 2}
        radiusY={height / 2}
        rotation={rotation}
        perfectDrawEnabled={false}
        {...commonProps}
      />
    );
  }

  return (
    <Rect
      x={x}
      y={y}
      width={width}
      height={height}
      rotation={rotation}
      offsetX={flipX ? width : 0}
      offsetY={flipY ? height : 0}
      scaleX={flipX ? -1 : 1}
      scaleY={flipY ? -1 : 1}
      cornerRadius={cornerRadius}
      perfectDrawEnabled={false}
      {...commonProps}
    />
  );
}

// Build Konva fontStyle string from fontWeight + fontStyle
// Konva accepts: 'normal', 'italic', 'bold', '500', 'italic bold', 'italic 500', etc.
export function buildKonvaFontStyle(node: TextNode): string {
  const style = node.fontStyle ?? "normal";
  const weight = node.fontWeight ?? "normal";
  if (style === "normal" && weight === "normal") return "normal";
  if (style === "normal") return weight;
  if (weight === "normal") return style;
  return `${style} ${weight}`;
}

// Build Konva textDecoration string from underline/strikethrough flags
export function buildTextDecoration(node: TextNode): string {
  const parts: string[] = [];
  if (node.underline) parts.push("underline");
  if (node.strikethrough) parts.push("line-through");
  return parts.join(" ") || "";
}

interface RectTransformInput {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  flipX?: boolean;
  flipY?: boolean;
}

export function getRectTransformProps({
  x,
  y,
  width,
  height,
  rotation,
  flipX,
  flipY,
}: RectTransformInput) {
  return {
    x,
    y,
    width,
    height,
    rotation: rotation ?? 0,
    offsetX: flipX ? width : 0,
    offsetY: flipY ? height : 0,
    scaleX: flipX ? -1 : 1,
    scaleY: flipY ? -1 : 1,
  };
}

interface EllipseTransformInput {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  flipX?: boolean;
  flipY?: boolean;
}

export function getEllipseTransformProps({
  x,
  y,
  width,
  height,
  rotation,
  flipX,
  flipY,
}: EllipseTransformInput) {
  return {
    x: x + width / 2,
    y: y + height / 2,
    radiusX: width / 2,
    radiusY: height / 2,
    rotation: rotation ?? 0,
    scaleX: flipX ? -1 : 1,
    scaleY: flipY ? -1 : 1,
  };
}

export function getTextDimensions(node: TextNode) {
  return {
    width: node.textWidthMode === "auto" ? undefined : node.width,
    height: node.textWidthMode === "fixed-height" ? node.height : undefined,
  };
}

interface ChildSelectOverrideInput {
  parentById: Record<string, string | null>;
  nodeId: string;
  isTopLevel: boolean;
  selectOverrideId?: string;
  enteredContainerId?: string | null;
}

export function getChildSelectOverride({
  parentById,
  nodeId,
  isTopLevel,
  selectOverrideId,
  enteredContainerId,
}: ChildSelectOverrideInput) {
  if (selectOverrideId) return selectOverrideId;
  const isEntered = enteredContainerId === nodeId;
  const isAncestorOfEntered = enteredContainerId
    ? isDescendantOfFlat(parentById, nodeId, enteredContainerId)
    : false;
  const childrenDirectlySelectable = isTopLevel || isEntered || isAncestorOfEntered;
  return childrenDirectlySelectable ? undefined : nodeId;
}

// Calculate image rendering params for a given fill mode.
// For "fill" (cover) mode, uses crop to select the visible portion of the source
// image so the rendered KonvaImage never exceeds container bounds.
interface ImageRenderParams {
  x: number;
  y: number;
  width: number;
  height: number;
  crop?: { x: number; y: number; width: number; height: number };
}

function calculateImageRenderParams(
  image: HTMLImageElement,
  mode: ImageFill["mode"],
  containerW: number,
  containerH: number,
): ImageRenderParams {
  if (mode === "stretch") {
    return { x: 0, y: 0, width: containerW, height: containerH };
  }

  const imgAspect = image.naturalWidth / image.naturalHeight;
  const containerAspect = containerW / containerH;

  if (mode === "fill") {
    // Cover: render at container size, crop source image to match aspect
    let cropX: number, cropY: number, cropW: number, cropH: number;
    if (imgAspect > containerAspect) {
      // Image is wider — crop sides
      cropH = image.naturalHeight;
      cropW = image.naturalHeight * containerAspect;
      cropX = (image.naturalWidth - cropW) / 2;
      cropY = 0;
    } else {
      // Image is taller — crop top/bottom
      cropW = image.naturalWidth;
      cropH = image.naturalWidth / containerAspect;
      cropX = 0;
      cropY = (image.naturalHeight - cropH) / 2;
    }
    return {
      x: 0,
      y: 0,
      width: containerW,
      height: containerH,
      crop: { x: cropX, y: cropY, width: cropW, height: cropH },
    };
  }

  // Fit: scale to contain, may letterbox
  let w: number, h: number;
  if (imgAspect > containerAspect) {
    w = containerW;
    h = containerW / imgAspect;
  } else {
    h = containerH;
    w = containerH * imgAspect;
  }

  return {
    x: (containerW - w) / 2,
    y: (containerH - h) / 2,
    width: w,
    height: h,
  };
}

// Render an image fill clipped to a rectangle or ellipse shape
interface ImageFillLayerProps {
  imageFill: ImageFill;
  width: number;
  height: number;
  x?: number;
  y?: number;
  cornerRadius?: number;
  clipType: "rect" | "ellipse";
}

export function ImageFillLayer({
  imageFill,
  width,
  height,
  x = 0,
  y = 0,
  cornerRadius,
  clipType,
}: ImageFillLayerProps) {
  const image = useLoadImage(imageFill.url);
  if (!image) return null;

  const params = calculateImageRenderParams(
    image,
    imageFill.mode,
    width,
    height,
  );

  return (
    <Group
      x={x}
      y={y}
      clipFunc={(ctx) => {
        const ctx2d = ctx._context;
        if (clipType === "ellipse") {
          ctx2d.beginPath();
          ctx2d.ellipse(
            width / 2,
            height / 2,
            width / 2,
            height / 2,
            0,
            0,
            Math.PI * 2,
          );
          ctx2d.closePath();
        } else if (cornerRadius && cornerRadius > 0) {
          ctx2d.beginPath();
          (
            ctx2d as unknown as {
              roundRect: (
                x: number,
                y: number,
                w: number,
                h: number,
                r: number,
              ) => void;
            }
          ).roundRect(0, 0, width, height, cornerRadius);
          ctx2d.closePath();
        } else {
          ctx2d.rect(0, 0, width, height);
        }
      }}
      listening={false}
    >
      <KonvaImage
        image={image}
        x={params.x}
        y={params.y}
        width={params.width}
        height={params.height}
        crop={params.crop}
        perfectDrawEnabled={false}
      />
    </Group>
  );
}

// Apply descendant overrides to a node
export function applyDescendantOverride(
  node: SceneNode,
  override?: DescendantOverride,
): SceneNode {
  if (!override) return node;
  // Apply override properties (excluding nested descendants)
  const { descendants: _, ...overrideProps } = override;
  const mergedNode = { ...node, ...overrideProps } as SceneNode;

  if (mergedNode.type !== "text") {
    return mergedNode;
  }

  const affectsTextMeasure = [
    "text",
    "fontSize",
    "fontFamily",
    "fontWeight",
    "fontStyle",
    "letterSpacing",
    "lineHeight",
    "textWidthMode",
    "width",
  ].some((key) => key in overrideProps);

  if (!affectsTextMeasure) {
    return mergedNode;
  }

  const textNode = mergedNode as TextNode;
  const mode = textNode.textWidthMode;
  if (!mode || mode === "auto") {
    const measured = measureTextAutoSize(textNode);
    return { ...textNode, width: measured.width, height: measured.height };
  }
  if (mode === "fixed") {
    const measuredHeight = measureTextFixedWidthHeight(textNode);
    return { ...textNode, height: measuredHeight };
  }
  return textNode;
}

// Check if a node should be rendered (considering enabled property)
export function isNodeEnabled(override?: DescendantOverride): boolean {
  return override?.enabled !== false;
}

// Per-side stroke rendering using 4 separate lines
interface PerSideStrokeLinesProps {
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor: string;
  strokeWidthPerSide: PerSideStroke;
  strokeAlign?: 'center' | 'inside' | 'outside';
  rotation?: number;
  flipX?: boolean;
  flipY?: boolean;
}

/**
 * Get the Y position for a horizontal per-side stroke line based on alignment.
 * - center: strokeWidth/2 from edge (default)
 * - inside: strokeWidth from edge (fully inside)
 * - outside: 0 from edge (fully outside, extends outward)
 */
function getPerSideOffset(strokeWidth: number, align: 'center' | 'inside' | 'outside'): number {
  switch (align) {
    case 'inside': return strokeWidth / 2;
    case 'outside': return -strokeWidth / 2;
    default: return 0; // center: stroke centered on edge
  }
}

export function PerSideStrokeLines({
  x,
  y,
  width,
  height,
  strokeColor,
  strokeWidthPerSide,
  strokeAlign = 'center',
  rotation = 0,
  flipX = false,
  flipY = false,
}: PerSideStrokeLinesProps) {
  const { top = 0, right = 0, bottom = 0, left = 0 } = strokeWidthPerSide;

  // Calculate offsets for flip transforms
  const offsetX = flipX ? width : 0;
  const offsetY = flipY ? height : 0;
  const scaleX = flipX ? -1 : 1;
  const scaleY = flipY ? -1 : 1;

  // Per-side offset adjustments based on alignment
  const topOff = getPerSideOffset(top, strokeAlign);
  const rightOff = getPerSideOffset(right, strokeAlign);
  const bottomOff = getPerSideOffset(bottom, strokeAlign);
  const leftOff = getPerSideOffset(left, strokeAlign);

  return (
    <Group
      x={x}
      y={y}
      rotation={rotation}
      offsetX={offsetX}
      offsetY={offsetY}
      scaleX={scaleX}
      scaleY={scaleY}
      listening={false}
    >
      {/* Top border */}
      {top > 0 && (
        <Line
          points={[0, top / 2 + topOff, width, top / 2 + topOff]}
          stroke={strokeColor}
          strokeWidth={top}
          lineCap="butt"
          perfectDrawEnabled={false}
        />
      )}
      {/* Right border */}
      {right > 0 && (
        <Line
          points={[width - right / 2 - rightOff, 0, width - right / 2 - rightOff, height]}
          stroke={strokeColor}
          strokeWidth={right}
          lineCap="butt"
          perfectDrawEnabled={false}
        />
      )}
      {/* Bottom border */}
      {bottom > 0 && (
        <Line
          points={[width, height - bottom / 2 - bottomOff, 0, height - bottom / 2 - bottomOff]}
          stroke={strokeColor}
          strokeWidth={bottom}
          lineCap="butt"
          perfectDrawEnabled={false}
        />
      )}
      {/* Left border */}
      {left > 0 && (
        <Line
          points={[left / 2 + leftOff, height, left / 2 + leftOff, 0]}
          stroke={strokeColor}
          strokeWidth={left}
          lineCap="butt"
          perfectDrawEnabled={false}
        />
      )}
    </Group>
  );
}

/**
 * Create a Konva sceneFunc for a Path that handles inside/outside stroke alignment.
 * Uses Path2D for SVG path data.
 */
export function makePathSceneFunc(
  geometry: string,
  scaleX: number,
  scaleY: number,
  geoOffsetX: number,
  geoOffsetY: number,
  fillColor: string | undefined,
  strokeColor: string | undefined,
  strokeWidth: number | undefined,
  strokeAlign: 'center' | 'inside' | 'outside',
  lineJoin: string,
  lineCap: string,
  fillRule?: string,
): ((ctx: any, shape: any) => void) | undefined {
  if (strokeAlign === 'center' || !strokeColor || !strokeWidth) return undefined;

  return (ctx: any, _shape: any) => {
    ctx.save();
    ctx.translate(geoOffsetX, geoOffsetY);
    ctx.scale(scaleX, scaleY);

    const path2d = new Path2D(geometry);

    if (fillColor) {
      ctx.fillStyle = fillColor;
      ctx.fill(path2d, fillRule === 'evenodd' ? 'evenodd' : 'nonzero');
    }

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = (strokeWidth * 2) / Math.min(scaleX, scaleY);
    ctx.lineJoin = lineJoin;
    ctx.lineCap = lineCap;

    if (strokeAlign === 'inside') {
      ctx.save();
      ctx.clip(path2d, fillRule === 'evenodd' ? 'evenodd' : 'nonzero');
      ctx.stroke(path2d);
      ctx.restore();
    } else {
      // outside
      ctx.save();
      // Large clip rect that excludes the shape interior
      const pad = strokeWidth * 4 / Math.min(scaleX, scaleY);
      const clipPath = new Path2D();
      clipPath.rect(-pad, -pad, (1 / scaleX) * 10000, (1 / scaleY) * 10000);
      clipPath.addPath(path2d);
      ctx.clip(clipPath, 'evenodd');
      ctx.stroke(path2d);
      ctx.restore();
    }

    ctx.restore();
  };
}

// Helper to check if node has per-side stroke
export function hasPerSideStroke(strokeWidthPerSide?: PerSideStroke): boolean {
  if (!strokeWidthPerSide) return false;
  const { top, right, bottom, left } = strokeWidthPerSide;
  return !!(top || right || bottom || left);
}

/**
 * Apply fill and stroke with inside/outside alignment using callbacks.
 *
 * Call this after the shape path has been set up. `drawShape` draws the full
 * shape path (including beginPath). `appendShapePath` appends the shape path
 * to an existing path (no beginPath). `outerClipRect` draws the outer bounding
 * rect for the evenodd outside-clip region.
 */
function applyStrokeAlignment(
  ctx: any,
  opts: {
    fillColor: string | undefined;
    strokeColor: string;
    strokeWidth: number;
    strokeAlign: 'inside' | 'outside';
    drawShape: (ctx: any) => void;
    appendShapePath: (ctx: any) => void;
    outerClipRect: (ctx: any, pad: number) => void;
  },
): void {
  const { fillColor, strokeColor, strokeWidth, strokeAlign, drawShape, appendShapePath, outerClipRect } = opts;

  drawShape(ctx);

  if (fillColor) {
    ctx.fillStyle = fillColor;
    ctx.fill();
  }

  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth * 2;

  if (strokeAlign === 'inside') {
    ctx.save();
    ctx.clip();
    ctx.stroke();
    ctx.restore();
  } else {
    const pad = strokeWidth * 2;
    ctx.save();
    ctx.beginPath();
    outerClipRect(ctx, pad);
    appendShapePath(ctx);
    ctx.clip('evenodd');
    drawShape(ctx);
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * Create a Konva sceneFunc for a Rect/Frame that handles inside/outside stroke alignment.
 * For 'center' alignment, returns undefined (use default Konva rendering).
 */
export function makeRectSceneFunc(
  width: number,
  height: number,
  cornerRadius: number | undefined,
  fillColor: string | undefined,
  strokeColor: string | undefined,
  strokeWidth: number | undefined,
  strokeAlign: 'center' | 'inside' | 'outside',
): ((ctx: any, shape: any) => void) | undefined {
  if (strokeAlign === 'center' || !strokeColor || !strokeWidth) return undefined;

  const cr = cornerRadius ?? 0;

  const drawRoundRectPath = (ctx: any) => {
    ctx.moveTo(cr, 0);
    ctx.lineTo(width - cr, 0);
    ctx.arcTo(width, 0, width, cr, cr);
    ctx.lineTo(width, height - cr);
    ctx.arcTo(width, height, width - cr, height, cr);
    ctx.lineTo(cr, height);
    ctx.arcTo(0, height, 0, height - cr, cr);
    ctx.lineTo(0, cr);
    ctx.arcTo(0, 0, cr, 0, cr);
    ctx.closePath();
  };

  const drawShape = (ctx: any) => {
    ctx.beginPath();
    if (cr > 0) drawRoundRectPath(ctx);
    else ctx.rect(0, 0, width, height);
  };

  const appendShapePath = (ctx: any) => {
    if (cr > 0) drawRoundRectPath(ctx);
    else ctx.rect(0, 0, width, height);
  };

  const outerClipRect = (ctx: any, pad: number) => {
    ctx.rect(-pad, -pad, width + pad * 2, height + pad * 2);
  };

  return (ctx: any, _shape: any) => {
    applyStrokeAlignment(ctx, { fillColor, strokeColor, strokeWidth, strokeAlign, drawShape, appendShapePath, outerClipRect });
  };
}

/**
 * Create a Konva sceneFunc for an Ellipse that handles inside/outside stroke alignment.
 */
export function makeEllipseSceneFunc(
  width: number,
  height: number,
  fillColor: string | undefined,
  strokeColor: string | undefined,
  strokeWidth: number | undefined,
  strokeAlign: 'center' | 'inside' | 'outside',
): ((ctx: any, shape: any) => void) | undefined {
  if (strokeAlign === 'center' || !strokeColor || !strokeWidth) return undefined;

  const rx = width / 2;
  const ry = height / 2;

  const drawShape = (ctx: any) => {
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.closePath();
  };

  const appendShapePath = (ctx: any) => {
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  };

  const outerClipRect = (ctx: any, pad: number) => {
    ctx.rect(-rx - pad, -ry - pad, width + pad * 2, height + pad * 2);
  };

  return (ctx: any, _shape: any) => {
    applyStrokeAlignment(ctx, { fillColor, strokeColor, strokeWidth, strokeAlign, drawShape, appendShapePath, outerClipRect });
  };
}

/**
 * Create a Konva sceneFunc for a closed polygon (Line with closed=true) with stroke alignment.
 */
export function makePolygonSceneFunc(
  points: number[],
  fillColor: string | undefined,
  strokeColor: string | undefined,
  strokeWidth: number | undefined,
  strokeAlign: 'center' | 'inside' | 'outside',
): ((ctx: any, shape: any) => void) | undefined {
  if (strokeAlign === 'center' || !strokeColor || !strokeWidth || points.length < 6) return undefined;

  // Precompute bounding rect for outside clip
  let polyMinX = Infinity, polyMinY = Infinity, polyMaxX = -Infinity, polyMaxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    if (points[i] < polyMinX) polyMinX = points[i];
    if (points[i] > polyMaxX) polyMaxX = points[i];
    if (points[i + 1] < polyMinY) polyMinY = points[i + 1];
    if (points[i + 1] > polyMaxY) polyMaxY = points[i + 1];
  }

  const drawPolyPath = (ctx: any) => {
    ctx.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) {
      ctx.lineTo(points[i], points[i + 1]);
    }
    ctx.closePath();
  };

  const drawShape = (ctx: any) => {
    ctx.beginPath();
    drawPolyPath(ctx);
  };

  const appendShapePath = (ctx: any) => {
    drawPolyPath(ctx);
  };

  const outerClipRect = (ctx: any, pad: number) => {
    ctx.rect(polyMinX - pad, polyMinY - pad, polyMaxX - polyMinX + pad * 2, polyMaxY - polyMinY + pad * 2);
  };

  return (ctx: any, _shape: any) => {
    applyStrokeAlignment(ctx, { fillColor, strokeColor, strokeWidth, strokeAlign, drawShape, appendShapePath, outerClipRect });
  };
}
