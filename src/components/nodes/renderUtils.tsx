import { Ellipse, Group, Image as KonvaImage, Rect } from "react-konva";
import type {
  DescendantOverride,
  ImageFill,
  SceneNode,
  TextNode,
} from "@/types/scene";
import { useLoadImage } from "@/hooks/useLoadImage";
import { isDescendantOf } from "@/utils/nodeUtils";

// Figma-style hover outline color
export const HOVER_OUTLINE_COLOR = "#0d99ff";

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
  nodes: SceneNode[];
  nodeId: string;
  isTopLevel: boolean;
  selectOverrideId?: string;
  enteredContainerId?: string | null;
}

export function getChildSelectOverride({
  nodes,
  nodeId,
  isTopLevel,
  selectOverrideId,
  enteredContainerId,
}: ChildSelectOverrideInput) {
  if (selectOverrideId) return selectOverrideId;
  const isEntered = enteredContainerId === nodeId;
  const isAncestorOfEntered = enteredContainerId
    ? isDescendantOf(nodes, nodeId, enteredContainerId)
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
  return { ...node, ...overrideProps } as SceneNode;
}

// Check if a node should be rendered (considering enabled property)
export function isNodeEnabled(override?: DescendantOverride): boolean {
  return override?.enabled !== false;
}
