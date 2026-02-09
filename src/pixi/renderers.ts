import { Container, Graphics, Text, TextStyle, FillGradient, Sprite, Texture, Assets, BlurFilter, GraphicsPath } from "pixi.js";
import type {
  FlatSceneNode,
  FlatFrameNode,
  FlatGroupNode,
  FrameNode,
  SceneNode,
  TextNode,
  RectNode,
  EllipseNode,
  LineNode,
  PolygonNode,
  PathNode,
  RefNode,
  GradientFill,
  ShadowEffect,
  ImageFill,
  PerSideStroke,
} from "@/types/scene";
import { toFlatNode } from "@/types/scene";
import { useVariableStore } from "@/store/variableStore";
import { useThemeStore } from "@/store/themeStore";
import { useLayoutStore } from "@/store/layoutStore";
import { resolveColor, applyOpacity } from "@/utils/colorUtils";
import { calculateFrameIntrinsicSize } from "@/utils/yogaLayout";

// --- Color helpers ---

function getResolvedFill(node: FlatSceneNode): string | undefined {
  const variables = useVariableStore.getState().variables;
  const theme = useThemeStore.getState().activeTheme;
  const raw = resolveColor(node.fill, node.fillBinding, variables, theme);
  return raw ? applyOpacity(raw, node.fillOpacity) : raw;
}

function getResolvedStroke(node: FlatSceneNode): string | undefined {
  const variables = useVariableStore.getState().variables;
  const theme = useThemeStore.getState().activeTheme;
  const raw = resolveColor(node.stroke, node.strokeBinding, variables, theme);
  return raw ? applyOpacity(raw, node.strokeOpacity) : raw;
}

function parseColor(color: string): number {
  // Handle rgba/rgb formats
  if (color.startsWith("rgba(") || color.startsWith("rgb(")) {
    const m = color.match(/[\d.]+/g);
    if (m && m.length >= 3) {
      const r = parseInt(m[0]);
      const g = parseInt(m[1]);
      const b = parseInt(m[2]);
      return (r << 16) | (g << 8) | b;
    }
  }
  // Handle hex
  const hex = color.replace("#", "");
  if (hex.length === 3) {
    return parseInt(hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2], 16);
  }
  // For 8-char hex (#RRGGBBAA), strip the alpha
  return parseInt(hex.slice(0, 6), 16);
}

function parseAlpha(color: string): number {
  if (color.startsWith("rgba(")) {
    const m = color.match(/[\d.]+/g);
    if (m && m.length >= 4) {
      return parseFloat(m[3]);
    }
  }
  if (color.startsWith("#") && color.length === 9) {
    return parseInt(color.slice(7, 9), 16) / 255;
  }
  return 1;
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// --- Per-side stroke helpers ---

function hasPerSideStroke(strokeWidthPerSide?: PerSideStroke): boolean {
  if (!strokeWidthPerSide) return false;
  const { top, right, bottom, left } = strokeWidthPerSide;
  return !!(top || right || bottom || left);
}

function drawPerSideStroke(
  gfx: Graphics,
  width: number,
  height: number,
  strokeColor: string,
  perSide: PerSideStroke,
): void {
  const color = parseColor(strokeColor);
  const alpha = parseAlpha(strokeColor);
  const { top = 0, right = 0, bottom = 0, left = 0 } = perSide;

  // Top border
  if (top > 0) {
    gfx.moveTo(0, top / 2);
    gfx.lineTo(width, top / 2);
    gfx.stroke({ color, alpha, width: top });
  }

  // Right border
  if (right > 0) {
    gfx.moveTo(width - right / 2, 0);
    gfx.lineTo(width - right / 2, height);
    gfx.stroke({ color, alpha, width: right });
  }

  // Bottom border
  if (bottom > 0) {
    gfx.moveTo(width, height - bottom / 2);
    gfx.lineTo(0, height - bottom / 2);
    gfx.stroke({ color, alpha, width: bottom });
  }

  // Left border
  if (left > 0) {
    gfx.moveTo(left / 2, height);
    gfx.lineTo(left / 2, 0);
    gfx.stroke({ color, alpha, width: left });
  }
}

// --- Gradient helpers ---

function buildPixiGradient(
  gradient: GradientFill,
  width: number,
  height: number,
): FillGradient {
  const sorted = [...gradient.stops].sort((a, b) => a.position - b.position);

  if (gradient.type === "linear") {
    const x0 = gradient.startX * width;
    const y0 = gradient.startY * height;
    const x1 = gradient.endX * width;
    const y1 = gradient.endY * height;

    const g = new FillGradient({
      type: "linear",
      start: { x: x0, y: y0 },
      end: { x: x1, y: y1 },
      colorStops: sorted.map((s) => ({
        offset: s.position,
        color: s.color,
      })),
    });
    return g;
  }

  // Radial - approximate with linear for now (PixiJS v8 FillGradient has limited radial support)
  const g = new FillGradient({
    type: "linear",
    start: { x: gradient.startX * width, y: gradient.startY * height },
    end: { x: gradient.endX * width, y: gradient.endY * height },
    colorStops: sorted.map((s) => ({
      offset: s.position,
      color: s.color,
    })),
  });
  return g;
}

// --- Shadow helpers ---

function applyShadow(container: Container, effect: ShadowEffect | undefined, width: number, height: number): void {
  // Remove existing shadow layer
  const existing = container.getChildByLabel("shadow-layer");
  if (existing) {
    container.removeChild(existing);
    existing.destroy({ children: true });
  }

  if (!effect) return;

  const { color: hexColor, opacity } = parseHexAlpha(effect.color);

  // Create shadow as a blurred shape behind the node
  const shadowContainer = new Container();
  shadowContainer.label = "shadow-layer";
  shadowContainer.position.set(effect.offset.x, effect.offset.y);

  const shadowGfx = new Graphics();
  shadowGfx.rect(0, 0, width, height);
  shadowGfx.fill({ color: parseColor(hexColor), alpha: opacity });
  shadowContainer.addChild(shadowGfx);

  if (effect.blur > 0) {
    shadowContainer.filters = [new BlurFilter({
      strength: effect.blur / 2,
      quality: 3,
    })];
  }

  // Insert at index 0 so shadow is behind everything
  container.addChildAt(shadowContainer, 0);
}

function parseHexAlpha(hex: string): { color: string; opacity: number } {
  if (hex.length === 9) {
    const alpha = parseInt(hex.slice(7, 9), 16) / 255;
    return { color: hex.slice(0, 7), opacity: alpha };
  }
  if (hex.length === 5) {
    const alpha = parseInt(hex[4] + hex[4], 16) / 255;
    return { color: hex.slice(0, 4), opacity: alpha };
  }
  return { color: hex, opacity: 1 };
}

// --- Image fill helpers ---

/** Cache for loaded textures by URL */
const textureCache = new Map<string, Texture>();
const loadingUrls = new Set<string>();

function applyImageFill(
  container: Container,
  imageFill: ImageFill | undefined,
  width: number,
  height: number,
  cornerRadius?: number,
): void {
  // Remove existing image sprite
  const existing = container.getChildByLabel("image-fill");
  if (existing) {
    container.removeChild(existing);
    existing.destroy();
  }

  if (!imageFill?.url) return;

  const cached = textureCache.get(imageFill.url);
  if (cached) {
    addImageSprite(container, cached, imageFill, width, height, cornerRadius);
  } else if (!loadingUrls.has(imageFill.url)) {
    loadingUrls.add(imageFill.url);
    Assets.load<Texture>(imageFill.url).then((texture) => {
      loadingUrls.delete(imageFill.url);
      if (texture) {
        textureCache.set(imageFill.url, texture);
        // Check container still exists and needs this image
        if (!container.destroyed) {
          addImageSprite(container, texture, imageFill, width, height, cornerRadius);
        }
      }
    }).catch(() => {
      loadingUrls.delete(imageFill.url);
    });
  }
}

function addImageSprite(
  container: Container,
  texture: Texture,
  imageFill: ImageFill,
  containerW: number,
  containerH: number,
  cornerRadius?: number,
): void {
  // Remove any existing image sprite first
  const existing = container.getChildByLabel("image-fill");
  if (existing) {
    container.removeChild(existing);
    existing.destroy();
  }

  const sprite = new Sprite(texture);
  sprite.label = "image-fill";

  const imgW = texture.width;
  const imgH = texture.height;
  const imgAspect = imgW / imgH;
  const containerAspect = containerW / containerH;

  if (imageFill.mode === "stretch") {
    sprite.width = containerW;
    sprite.height = containerH;
  } else if (imageFill.mode === "fill") {
    // Cover: fill container, crop overflow
    let sw: number, sh: number;
    if (imgAspect > containerAspect) {
      sh = containerH;
      sw = containerH * imgAspect;
    } else {
      sw = containerW;
      sh = containerW / imgAspect;
    }
    sprite.width = sw;
    sprite.height = sh;
    sprite.x = (containerW - sw) / 2;
    sprite.y = (containerH - sh) / 2;
  } else {
    // Fit: contain within bounds
    let sw: number, sh: number;
    if (imgAspect > containerAspect) {
      sw = containerW;
      sh = containerW / imgAspect;
    } else {
      sh = containerH;
      sw = containerH * imgAspect;
    }
    sprite.width = sw;
    sprite.height = sh;
    sprite.x = (containerW - sw) / 2;
    sprite.y = (containerH - sh) / 2;
  }

  // Apply mask for clipping (cornerRadius or bounds)
  if (cornerRadius && cornerRadius > 0) {
    const mask = new Graphics();
    mask.label = "image-mask";
    mask.roundRect(0, 0, containerW, containerH, cornerRadius);
    mask.fill(0xffffff);
    container.addChild(mask);
    sprite.mask = mask;
  }

  // Insert after background but before children
  const bgChild = container.getChildByLabel("rect-bg") ??
    container.getChildByLabel("ellipse-bg") ??
    container.getChildByLabel("frame-bg");
  if (bgChild) {
    const bgIndex = container.getChildIndex(bgChild);
    container.addChildAt(sprite, bgIndex + 1);
  } else {
    container.addChildAt(sprite, 0);
  }
}

function applyImageFillEllipse(
  container: Container,
  imageFill: ImageFill | undefined,
  width: number,
  height: number,
): void {
  // Remove existing
  const existing = container.getChildByLabel("image-fill");
  if (existing) {
    container.removeChild(existing);
    existing.destroy();
  }
  const existingMask = container.getChildByLabel("image-mask");
  if (existingMask) {
    container.removeChild(existingMask);
    existingMask.destroy();
  }

  if (!imageFill?.url) return;

  const cached = textureCache.get(imageFill.url);
  if (cached) {
    addImageSpriteEllipse(container, cached, imageFill, width, height);
  } else if (!loadingUrls.has(imageFill.url)) {
    loadingUrls.add(imageFill.url);
    Assets.load<Texture>(imageFill.url).then((texture) => {
      loadingUrls.delete(imageFill.url);
      if (texture && !container.destroyed) {
        textureCache.set(imageFill.url, texture);
        addImageSpriteEllipse(container, texture, imageFill, width, height);
      }
    }).catch(() => {
      loadingUrls.delete(imageFill.url);
    });
  }
}

function addImageSpriteEllipse(
  container: Container,
  texture: Texture,
  imageFill: ImageFill,
  containerW: number,
  containerH: number,
): void {
  const existing = container.getChildByLabel("image-fill");
  if (existing) {
    container.removeChild(existing);
    existing.destroy();
  }

  const sprite = new Sprite(texture);
  sprite.label = "image-fill";

  const imgW = texture.width;
  const imgH = texture.height;
  const imgAspect = imgW / imgH;
  const containerAspect = containerW / containerH;

  if (imageFill.mode === "stretch") {
    sprite.width = containerW;
    sprite.height = containerH;
  } else if (imageFill.mode === "fill") {
    let sw: number, sh: number;
    if (imgAspect > containerAspect) {
      sh = containerH;
      sw = containerH * imgAspect;
    } else {
      sw = containerW;
      sh = containerW / imgAspect;
    }
    sprite.width = sw;
    sprite.height = sh;
    sprite.x = (containerW - sw) / 2;
    sprite.y = (containerH - sh) / 2;
  } else {
    let sw: number, sh: number;
    if (imgAspect > containerAspect) {
      sw = containerW;
      sh = containerW / imgAspect;
    } else {
      sh = containerH;
      sw = containerH * imgAspect;
    }
    sprite.width = sw;
    sprite.height = sh;
    sprite.x = (containerW - sw) / 2;
    sprite.y = (containerH - sh) / 2;
  }

  // Elliptical mask
  const mask = new Graphics();
  mask.label = "image-mask";
  mask.ellipse(containerW / 2, containerH / 2, containerW / 2, containerH / 2);
  mask.fill(0xffffff);
  container.addChild(mask);
  sprite.mask = mask;

  const bgChild = container.getChildByLabel("ellipse-bg");
  if (bgChild) {
    const bgIndex = container.getChildIndex(bgChild);
    container.addChildAt(sprite, bgIndex + 1);
  } else {
    container.addChildAt(sprite, 0);
  }
}

// --- Node renderers ---

/**
 * Create a PixiJS Container for a given flat scene node.
 * This is the main dispatch function.
 */
export function createNodeContainer(
  node: FlatSceneNode,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
): Container {
  let container: Container;

  switch (node.type) {
    case "frame":
      container = createFrameContainer(
        node as FlatFrameNode,
        nodesById,
        childrenById,
      );
      break;
    case "group":
      container = createGroupContainer(
        node as FlatGroupNode,
        nodesById,
        childrenById,
      );
      break;
    case "rect":
      container = createRectContainer(node as RectNode);
      break;
    case "ellipse":
      container = createEllipseContainer(node as EllipseNode);
      break;
    case "text":
      container = createTextContainer(node as TextNode);
      break;
    case "line":
      container = createLineContainer(node as LineNode);
      break;
    case "polygon":
      container = createPolygonContainer(node as PolygonNode);
      break;
    case "path":
      container = createPathContainer(node as PathNode);
      break;
    case "ref":
      container = createRefContainer(
        node as RefNode,
        nodesById,
        childrenById,
      );
      break;
    default:
      container = new Container();
  }

  // Common properties
  container.label = node.id;
  // Position will be set by applyAutoLayoutPositions for auto-layout children
  // For now, set it from node (will be overwritten if in auto-layout)
  container.position.set(node.x, node.y);
  container.alpha = node.opacity ?? 1;
  container.visible = node.visible !== false;

  // Rotation (convert degrees to radians)
  if (node.rotation) {
    container.rotation = (node.rotation * Math.PI) / 180;
  }

  // Flip via scale
  if (node.flipX || node.flipY) {
    container.scale.set(node.flipX ? -1 : 1, node.flipY ? -1 : 1);
    if (node.flipX) container.pivot.x = node.width;
    if (node.flipY) container.pivot.y = node.height;
  }

  // Shadow
  applyShadow(container, node.effect, node.width, node.height);

  return container;
}

/**
 * Update an existing container when the node changes.
 */
export function updateNodeContainer(
  container: Container,
  node: FlatSceneNode,
  prev: FlatSceneNode,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
  skipPosition?: boolean,
): void {
  // Position - skip for auto-layout children (handled by applyAutoLayoutPositions)
  if (!skipPosition && (node.x !== prev.x || node.y !== prev.y)) {
    container.position.set(node.x, node.y);
  }

  // Opacity
  if (node.opacity !== prev.opacity) {
    container.alpha = node.opacity ?? 1;
  }

  // Visibility
  if (node.visible !== prev.visible) {
    container.visible = node.visible !== false;
  }

  // Rotation
  if (node.rotation !== prev.rotation) {
    container.rotation = ((node.rotation ?? 0) * Math.PI) / 180;
  }

  // Flip
  if (node.flipX !== prev.flipX || node.flipY !== prev.flipY) {
    container.scale.set(node.flipX ? -1 : 1, node.flipY ? -1 : 1);
    container.pivot.x = node.flipX ? node.width : 0;
    container.pivot.y = node.flipY ? node.height : 0;
  }

  // Shadow
  if (node.effect !== prev.effect || node.width !== prev.width || node.height !== prev.height) {
    applyShadow(container, node.effect, node.width, node.height);
  }

  // Type-specific updates
  switch (node.type) {
    case "frame":
      updateFrameContainer(
        container,
        node as FlatFrameNode,
        prev as FlatFrameNode,
        nodesById,
        childrenById,
      );
      break;
    case "group":
      // Group just needs position/visibility which is handled above
      break;
    case "rect":
      updateRectContainer(container, node as RectNode, prev as RectNode);
      break;
    case "ellipse":
      updateEllipseContainer(
        container,
        node as EllipseNode,
        prev as EllipseNode,
      );
      break;
    case "text":
      updateTextContainer(container, node as TextNode, prev as TextNode);
      break;
    case "line":
      updateLineContainer(container, node as LineNode, prev as LineNode);
      break;
    case "polygon":
      updatePolygonContainer(
        container,
        node as PolygonNode,
        prev as PolygonNode,
      );
      break;
    case "path":
      updatePathContainer(container, node as PathNode, prev as PathNode);
      break;
    case "ref":
      updateRefContainer(
        container,
        node as RefNode,
        prev as RefNode,
        nodesById,
        childrenById,
      );
      break;
  }
}

/**
 * Apply layout-computed size to a container's graphics.
 * Used for fill_container children in auto-layout frames.
 */
export function applyLayoutSize(
  container: Container,
  node: FlatSceneNode,
  layoutWidth: number,
  layoutHeight: number,
): void {
  // Skip if size hasn't changed
  if (node.width === layoutWidth && node.height === layoutHeight) return;

  switch (node.type) {
    case "rect": {
      const gfx = container.getChildByLabel("rect-bg") as Graphics;
      if (gfx) {
        gfx.clear();
        drawRect(gfx, { ...node, width: layoutWidth, height: layoutHeight } as RectNode);
      }
      break;
    }
    case "ellipse": {
      const gfx = container.getChildByLabel("ellipse-bg") as Graphics;
      if (gfx) {
        gfx.clear();
        drawEllipse(gfx, { ...node, width: layoutWidth, height: layoutHeight } as EllipseNode);
      }
      break;
    }
    case "frame": {
      const bg = container.getChildByLabel("frame-bg") as Graphics;
      if (bg) {
        bg.clear();
        drawFrameBackground(bg, node as FlatFrameNode, layoutWidth, layoutHeight);
      }
      // Update mask if present
      const mask = container.getChildByLabel("frame-mask") as Graphics;
      if (mask && (node as FlatFrameNode).clip) {
        mask.clear();
        const frameNode = node as FlatFrameNode;
        if (frameNode.cornerRadius) {
          mask.roundRect(0, 0, layoutWidth, layoutHeight, frameNode.cornerRadius);
        } else {
          mask.rect(0, 0, layoutWidth, layoutHeight);
        }
        mask.fill(0xffffff);
      }
      break;
    }
    // Text and other types don't need size updates for layout
  }
}

// --- Rect ---

function createRectContainer(node: RectNode): Container {
  const container = new Container();
  const gfx = new Graphics();
  gfx.label = "rect-bg";
  drawRect(gfx, node);
  container.addChild(gfx);

  // Image fill
  if (node.imageFill) {
    applyImageFill(container, node.imageFill, node.width, node.height, node.cornerRadius);
  }

  return container;
}

function updateRectContainer(
  container: Container,
  node: RectNode,
  prev: RectNode,
): void {
  // Check if visual properties changed
  if (
    node.width !== prev.width ||
    node.height !== prev.height ||
    node.fill !== prev.fill ||
    node.fillBinding !== prev.fillBinding ||
    node.fillOpacity !== prev.fillOpacity ||
    node.stroke !== prev.stroke ||
    node.strokeBinding !== prev.strokeBinding ||
    node.strokeOpacity !== prev.strokeOpacity ||
    node.strokeWidth !== prev.strokeWidth ||
    node.strokeWidthPerSide !== prev.strokeWidthPerSide ||
    node.cornerRadius !== prev.cornerRadius ||
    node.gradientFill !== prev.gradientFill
  ) {
    const gfx = container.getChildByLabel("rect-bg") as Graphics;
    if (gfx) {
      gfx.clear();
      drawRect(gfx, node);
    }
  }

  // Image fill
  if (
    node.imageFill !== prev.imageFill ||
    node.width !== prev.width ||
    node.height !== prev.height
  ) {
    applyImageFill(container, node.imageFill, node.width, node.height, node.cornerRadius);
  }
}

function drawRect(gfx: Graphics, node: RectNode): void {
  const fillColor = getResolvedFill(node);
  const strokeColor = getResolvedStroke(node);
  const usePerSideStroke = hasPerSideStroke(node.strokeWidthPerSide);

  // Fill
  if (node.gradientFill) {
    const gradient = buildPixiGradient(node.gradientFill, node.width, node.height);
    gfx.fill(gradient);
  } else if (fillColor) {
    gfx.fill({ color: parseColor(fillColor), alpha: parseAlpha(fillColor) });
  }

  // Draw shape
  if (node.cornerRadius) {
    gfx.roundRect(0, 0, node.width, node.height, node.cornerRadius);
  } else {
    gfx.rect(0, 0, node.width, node.height);
  }
  gfx.fill();

  // Stroke
  if (usePerSideStroke && strokeColor && node.strokeWidthPerSide) {
    // Per-side stroke (only for rectangles without corner radius)
    if (!node.cornerRadius) {
      drawPerSideStroke(gfx, node.width, node.height, strokeColor, node.strokeWidthPerSide);
    } else {
      // Fall back to max stroke width for rounded corners
      const maxWidth = Math.max(
        node.strokeWidthPerSide.top ?? 0,
        node.strokeWidthPerSide.right ?? 0,
        node.strokeWidthPerSide.bottom ?? 0,
        node.strokeWidthPerSide.left ?? 0,
      );
      if (maxWidth > 0) {
        gfx.stroke({
          color: parseColor(strokeColor),
          alpha: parseAlpha(strokeColor),
          width: maxWidth,
        });
      }
    }
  } else if (strokeColor && node.strokeWidth) {
    // Unified stroke
    gfx.stroke({
      color: parseColor(strokeColor),
      alpha: parseAlpha(strokeColor),
      width: node.strokeWidth,
    });
  }
}

// --- Ellipse ---

function createEllipseContainer(node: EllipseNode): Container {
  const container = new Container();
  const gfx = new Graphics();
  gfx.label = "ellipse-bg";
  drawEllipse(gfx, node);
  container.addChild(gfx);

  // Image fill with elliptical clipping
  if (node.imageFill) {
    applyImageFillEllipse(container, node.imageFill, node.width, node.height);
  }

  return container;
}

function updateEllipseContainer(
  container: Container,
  node: EllipseNode,
  prev: EllipseNode,
): void {
  if (
    node.width !== prev.width ||
    node.height !== prev.height ||
    node.fill !== prev.fill ||
    node.fillBinding !== prev.fillBinding ||
    node.fillOpacity !== prev.fillOpacity ||
    node.stroke !== prev.stroke ||
    node.strokeBinding !== prev.strokeBinding ||
    node.strokeOpacity !== prev.strokeOpacity ||
    node.strokeWidth !== prev.strokeWidth ||
    node.gradientFill !== prev.gradientFill
  ) {
    const gfx = container.getChildByLabel("ellipse-bg") as Graphics;
    if (gfx) {
      gfx.clear();
      drawEllipse(gfx, node);
    }
  }

  // Image fill
  if (
    node.imageFill !== prev.imageFill ||
    node.width !== prev.width ||
    node.height !== prev.height
  ) {
    applyImageFillEllipse(container, node.imageFill, node.width, node.height);
  }
}

function drawEllipse(gfx: Graphics, node: EllipseNode): void {
  const fillColor = getResolvedFill(node);
  const strokeColor = getResolvedStroke(node);

  if (node.gradientFill) {
    const gradient = buildPixiGradient(node.gradientFill, node.width, node.height);
    gfx.fill(gradient);
  } else if (fillColor) {
    gfx.fill({ color: parseColor(fillColor), alpha: parseAlpha(fillColor) });
  }

  gfx.ellipse(node.width / 2, node.height / 2, node.width / 2, node.height / 2);
  gfx.fill();

  if (strokeColor && node.strokeWidth) {
    gfx.stroke({
      color: parseColor(strokeColor),
      alpha: parseAlpha(strokeColor),
      width: node.strokeWidth,
    });
  }
}

// --- Text ---

function createTextContainer(node: TextNode): Container {
  const container = new Container();
  const text = new Text({
    text: node.text,
    style: buildTextStyle(node),
  });
  text.label = "text-content";
  text.anchor.set(0, 0);
  container.addChild(text);
  return container;
}

function updateTextContainer(
  container: Container,
  node: TextNode,
  prev: TextNode,
): void {
  const textObj = container.getChildByLabel("text-content") as Text;
  if (!textObj) return;

  if (node.text !== prev.text) {
    textObj.text = node.text;
  }

  // Rebuild style if any text property changed
  if (
    node.fontSize !== prev.fontSize ||
    node.fontFamily !== prev.fontFamily ||
    node.fontWeight !== prev.fontWeight ||
    node.fontStyle !== prev.fontStyle ||
    node.fill !== prev.fill ||
    node.fillBinding !== prev.fillBinding ||
    node.fillOpacity !== prev.fillOpacity ||
    node.textAlign !== prev.textAlign ||
    node.lineHeight !== prev.lineHeight ||
    node.letterSpacing !== prev.letterSpacing ||
    node.width !== prev.width ||
    node.textWidthMode !== prev.textWidthMode ||
    node.underline !== prev.underline ||
    node.strikethrough !== prev.strikethrough ||
    node.gradientFill !== prev.gradientFill
  ) {
    textObj.style = buildTextStyle(node);
  }
}

function buildTextStyle(node: TextNode): TextStyle {
  const fillColor = getResolvedFill(node) ?? "#000000";
  const isWrapped = node.textWidthMode === "fixed" || node.textWidthMode === "fixed-height";
  const fontSize = node.fontSize ?? 16;
  const lineHeightMultiplier = node.lineHeight ?? 1.2;

  return new TextStyle({
    fontFamily: node.fontFamily || "Arial",
    fontSize: fontSize,
    fontWeight: (node.fontWeight as TextStyle["fontWeight"]) ?? "normal",
    fontStyle: (node.fontStyle as TextStyle["fontStyle"]) ?? "normal",
    fill: fillColor,
    wordWrap: isWrapped,
    wordWrapWidth: isWrapped ? node.width : undefined,
    align: node.textAlign ?? "left",
    lineHeight: fontSize * lineHeightMultiplier,
    letterSpacing: node.letterSpacing ?? 0,
  });
}

// --- Line ---

function createLineContainer(node: LineNode): Container {
  const container = new Container();
  const gfx = new Graphics();
  gfx.label = "line-gfx";
  drawLine(gfx, node);
  container.addChild(gfx);
  return container;
}

function updateLineContainer(
  container: Container,
  node: LineNode,
  prev: LineNode,
): void {
  if (
    node.points !== prev.points ||
    node.stroke !== prev.stroke ||
    node.strokeBinding !== prev.strokeBinding ||
    node.strokeOpacity !== prev.strokeOpacity ||
    node.strokeWidth !== prev.strokeWidth
  ) {
    const gfx = container.getChildByLabel("line-gfx") as Graphics;
    if (gfx) {
      gfx.clear();
      drawLine(gfx, node);
    }
  }
}

function drawLine(gfx: Graphics, node: LineNode): void {
  const strokeColor = getResolvedStroke(node) ?? "#000000";
  const points = node.points;
  if (points.length < 4) return;

  gfx.moveTo(points[0], points[1]);
  gfx.lineTo(points[2], points[3]);
  gfx.stroke({
    color: parseColor(strokeColor),
    alpha: parseAlpha(strokeColor),
    width: node.strokeWidth ?? 1,
  });
}

// --- Polygon ---

function createPolygonContainer(node: PolygonNode): Container {
  const container = new Container();
  const gfx = new Graphics();
  gfx.label = "polygon-gfx";
  drawPolygon(gfx, node);
  container.addChild(gfx);
  return container;
}

function updatePolygonContainer(
  container: Container,
  node: PolygonNode,
  prev: PolygonNode,
): void {
  if (
    node.points !== prev.points ||
    node.width !== prev.width ||
    node.height !== prev.height ||
    node.fill !== prev.fill ||
    node.fillBinding !== prev.fillBinding ||
    node.fillOpacity !== prev.fillOpacity ||
    node.stroke !== prev.stroke ||
    node.strokeBinding !== prev.strokeBinding ||
    node.strokeOpacity !== prev.strokeOpacity ||
    node.strokeWidth !== prev.strokeWidth ||
    node.gradientFill !== prev.gradientFill
  ) {
    const gfx = container.getChildByLabel("polygon-gfx") as Graphics;
    if (gfx) {
      gfx.clear();
      drawPolygon(gfx, node);
    }
  }
}

function drawPolygon(gfx: Graphics, node: PolygonNode): void {
  const fillColor = getResolvedFill(node);
  const strokeColor = getResolvedStroke(node);
  const points = node.points;
  if (!points || points.length < 6) return;

  if (node.gradientFill) {
    const gradient = buildPixiGradient(node.gradientFill, node.width, node.height);
    gfx.fill(gradient);
  } else if (fillColor) {
    gfx.fill({ color: parseColor(fillColor), alpha: parseAlpha(fillColor) });
  }

  gfx.poly(points, true);
  gfx.fill();

  if (strokeColor && node.strokeWidth) {
    gfx.stroke({
      color: parseColor(strokeColor),
      alpha: parseAlpha(strokeColor),
      width: node.strokeWidth,
    });
  }
}

// --- Path ---

function createPathContainer(node: PathNode): Container {
  const container = new Container();
  const gfx = new Graphics();
  gfx.label = "path-gfx";
  drawPath(gfx, node);
  container.addChild(gfx);
  return container;
}

function updatePathContainer(
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

function drawPath(gfx: Graphics, node: PathNode): void {
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

      // Debug log - full SVG for first compound path only
      if (isCompoundPath && node.id === "e3lrktq") {
        console.log(`[path-debug] FULL SVG for comet:`, svgMarkup);
      }

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

// --- Frame ---

/**
 * Convert flat frame to tree frame for layout calculations
 */
function flatToTreeFrame(
  node: FlatFrameNode,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
): FrameNode {
  const childIds = childrenById[node.id] ?? [];
  const children: SceneNode[] = [];

  for (const childId of childIds) {
    const childNode = nodesById[childId];
    if (!childNode) continue;

    if (childNode.type === "frame") {
      children.push(flatToTreeFrame(childNode as FlatFrameNode, nodesById, childrenById));
    } else {
      children.push(childNode as SceneNode);
    }
  }

  return { ...node, children } as FrameNode;
}

/**
 * Calculate effective width/height for frames with fit_content sizing
 */
function getFrameEffectiveSize(
  node: FlatFrameNode,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
): { width: number; height: number } {
  const fitWidth = node.sizing?.widthMode === "fit_content" && node.layout?.autoLayout;
  const fitHeight = node.sizing?.heightMode === "fit_content" && node.layout?.autoLayout;

  if (!fitWidth && !fitHeight) {
    return { width: node.width, height: node.height };
  }

  const treeFrame = flatToTreeFrame(node, nodesById, childrenById);
  const intrinsicSize = calculateFrameIntrinsicSize(treeFrame, { fitWidth, fitHeight });

  return {
    width: fitWidth ? intrinsicSize.width : node.width,
    height: fitHeight ? intrinsicSize.height : node.height,
  };
}

function createFrameContainer(
  node: FlatFrameNode,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
): Container {
  const container = new Container();

  // Calculate effective size for fit_content frames
  const { width: effectiveWidth, height: effectiveHeight } = getFrameEffectiveSize(node, nodesById, childrenById);

  // Store effective size for later use
  (container as any)._effectiveWidth = effectiveWidth;
  (container as any)._effectiveHeight = effectiveHeight;

  // Background
  const bg = new Graphics();
  bg.label = "frame-bg";
  drawFrameBackground(bg, node, effectiveWidth, effectiveHeight);
  container.addChild(bg);

  // Image fill
  if (node.imageFill) {
    applyImageFill(container, node.imageFill, effectiveWidth, effectiveHeight, node.cornerRadius);
  }

  // Clipping mask
  if (node.clip) {
    const mask = new Graphics();
    mask.label = "frame-mask";
    if (node.cornerRadius) {
      mask.roundRect(0, 0, effectiveWidth, effectiveHeight, node.cornerRadius);
    } else {
      mask.rect(0, 0, effectiveWidth, effectiveHeight);
    }
    mask.fill(0xffffff);
    container.addChild(mask);
    container.mask = mask;
  }

  // Children container
  const childrenContainer = new Container();
  childrenContainer.label = "frame-children";
  container.addChild(childrenContainer);

  // Render children
  const childIds = childrenById[node.id] ?? [];
  for (const childId of childIds) {
    const childNode = nodesById[childId];
    if (childNode) {
      const childContainer = createNodeContainer(
        childNode,
        nodesById,
        childrenById,
      );
      childrenContainer.addChild(childContainer);
    }
  }

  // Cache as texture for frames with many children (performance optimization)
  if (childIds.length >= 30) {
    container.cacheAsTexture(true);
  }

  return container;
}

function updateFrameContainer(
  container: Container,
  node: FlatFrameNode,
  prev: FlatFrameNode,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
): void {
  // Calculate effective size for fit_content frames
  const { width: effectiveWidth, height: effectiveHeight } = getFrameEffectiveSize(node, nodesById, childrenById);

  // Store effective size for later use
  (container as any)._effectiveWidth = effectiveWidth;
  (container as any)._effectiveHeight = effectiveHeight;

  // Update background
  if (
    node.width !== prev.width ||
    node.height !== prev.height ||
    node.fill !== prev.fill ||
    node.fillBinding !== prev.fillBinding ||
    node.fillOpacity !== prev.fillOpacity ||
    node.stroke !== prev.stroke ||
    node.strokeBinding !== prev.strokeBinding ||
    node.strokeOpacity !== prev.strokeOpacity ||
    node.strokeWidth !== prev.strokeWidth ||
    node.strokeWidthPerSide !== prev.strokeWidthPerSide ||
    node.cornerRadius !== prev.cornerRadius ||
    node.gradientFill !== prev.gradientFill ||
    node.sizing !== prev.sizing ||
    node.layout !== prev.layout
  ) {
    const bg = container.getChildByLabel("frame-bg") as Graphics;
    if (bg) {
      bg.clear();
      drawFrameBackground(bg, node, effectiveWidth, effectiveHeight);
    }
  }

  // Image fill
  if (
    node.imageFill !== prev.imageFill ||
    node.width !== prev.width ||
    node.height !== prev.height ||
    node.sizing !== prev.sizing ||
    node.layout !== prev.layout
  ) {
    applyImageFill(container, node.imageFill, effectiveWidth, effectiveHeight, node.cornerRadius);
  }

  // Update clip mask
  if (
    node.clip !== prev.clip ||
    node.width !== prev.width ||
    node.height !== prev.height ||
    node.cornerRadius !== prev.cornerRadius ||
    node.sizing !== prev.sizing ||
    node.layout !== prev.layout
  ) {
    const existingMask = container.getChildByLabel("frame-mask") as Graphics;
    if (node.clip) {
      const mask = existingMask ?? new Graphics();
      mask.label = "frame-mask";
      mask.clear();
      if (node.cornerRadius) {
        mask.roundRect(0, 0, effectiveWidth, effectiveHeight, node.cornerRadius);
      } else {
        mask.rect(0, 0, effectiveWidth, effectiveHeight);
      }
      mask.fill(0xffffff);
      if (!existingMask) {
        container.addChild(mask);
      }
      container.mask = mask;
    } else if (existingMask) {
      container.mask = null;
      container.removeChild(existingMask);
      existingMask.destroy();
    }
  }
}

function drawFrameBackground(
  gfx: Graphics,
  node: FlatFrameNode,
  effectiveWidth?: number,
  effectiveHeight?: number,
): void {
  const width = effectiveWidth ?? node.width;
  const height = effectiveHeight ?? node.height;
  const fillColor = getResolvedFill(node);
  const strokeColor = getResolvedStroke(node);
  const usePerSideStroke = hasPerSideStroke(node.strokeWidthPerSide);

  if (node.cornerRadius) {
    gfx.roundRect(0, 0, width, height, node.cornerRadius);
  } else {
    gfx.rect(0, 0, width, height);
  }

  if (node.gradientFill) {
    const gradient = buildPixiGradient(node.gradientFill, width, height);
    gfx.fill(gradient);
  } else if (fillColor) {
    gfx.fill({ color: parseColor(fillColor), alpha: parseAlpha(fillColor) });
  }

  // Stroke
  if (usePerSideStroke && strokeColor && node.strokeWidthPerSide) {
    // Per-side stroke (only for frames without corner radius)
    if (!node.cornerRadius) {
      drawPerSideStroke(gfx, width, height, strokeColor, node.strokeWidthPerSide);
    } else {
      // Fall back to max stroke width for rounded corners
      const maxWidth = Math.max(
        node.strokeWidthPerSide.top ?? 0,
        node.strokeWidthPerSide.right ?? 0,
        node.strokeWidthPerSide.bottom ?? 0,
        node.strokeWidthPerSide.left ?? 0,
      );
      if (maxWidth > 0) {
        gfx.stroke({
          color: parseColor(strokeColor),
          alpha: parseAlpha(strokeColor),
          width: maxWidth,
        });
      }
    }
  } else if (strokeColor && node.strokeWidth) {
    // Unified stroke
    gfx.stroke({
      color: parseColor(strokeColor),
      alpha: parseAlpha(strokeColor),
      width: node.strokeWidth,
    });
  }
}

// --- Group ---

function createGroupContainer(
  node: FlatGroupNode,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
): Container {
  const container = new Container();

  // Children container
  const childrenContainer = new Container();
  childrenContainer.label = "group-children";
  container.addChild(childrenContainer);

  // Render children
  const childIds = childrenById[node.id] ?? [];
  for (const childId of childIds) {
    const childNode = nodesById[childId];
    if (childNode) {
      const childContainer = createNodeContainer(
        childNode,
        nodesById,
        childrenById,
      );
      childrenContainer.addChild(childContainer);
    }
  }

  return container;
}

// --- Ref (Instance) ---

function createRefContainer(
  node: RefNode,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
): Container {
  const container = new Container();
  const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;

  // Find the component
  const component = nodesById[node.componentId];
  if (!component) {
    // Component not found - draw placeholder
    const gfx = new Graphics();
    gfx.label = "ref-placeholder";
    gfx.rect(0, 0, node.width, node.height);
    gfx.fill({ color: 0xcccccc, alpha: 0.5 });
    gfx.stroke({ color: 0x999999, width: 1 });
    container.addChild(gfx);
    return container;
  }

  // Render the component tree with overrides
  const childrenContainer = new Container();
  childrenContainer.label = "ref-children";

  const componentTree = component.type === "frame"
    ? flatToTreeFrame(component as FlatFrameNode, nodesById, childrenById)
    : null;
  const layoutChildren = componentTree?.layout?.autoLayout
    ? calculateLayoutForFrame(componentTree)
    : null;
  const renderedChildren = layoutChildren ?? componentTree?.children ?? [];

  // Draw component background
  if (component.type === "frame") {
    const bg = new Graphics();
    bg.label = "ref-bg";
    const frame = component as FlatFrameNode;
    const fillColor = getResolvedFill(frame);
    if (fillColor) {
      bg.fill({ color: parseColor(fillColor), alpha: parseAlpha(fillColor) });
    }
    if (frame.cornerRadius) {
      bg.roundRect(0, 0, node.width, node.height, frame.cornerRadius);
    } else {
      bg.rect(0, 0, node.width, node.height);
    }
    bg.fill();
    childrenContainer.addChild(bg);
  }

  const componentFrame = component as FlatFrameNode;
  const slotIds = componentFrame.slot ?? [];

  for (const child of renderedChildren) {
    const childOverride = node.descendants?.[child.id];
    if (childOverride?.enabled === false) continue;

    // Check for slot replacement
    const isSlot = slotIds.includes(child.id);
    const slotReplacement = isSlot ? node.slotContent?.[child.id] : undefined;

    if (slotReplacement) {
      // Render the replacement node using toFlatNode()
      const flatReplacement = toFlatNode(slotReplacement);
      const childContainer = createNodeContainer(flatReplacement, nodesById, childrenById);
      childrenContainer.addChild(childContainer);
      continue;
    }

    const sourceNode = nodesById[child.id];
    if (!sourceNode) continue;

    const overrideProps = childOverride ? { ...childOverride } : {};
    if ("descendants" in overrideProps) {
      delete overrideProps.descendants;
    }
    const resolved = {
      ...(sourceNode as FlatSceneNode),
      ...(child as Partial<SceneNode>),
      ...overrideProps,
    } as FlatSceneNode;

    const childContainer = createNodeContainer(
      resolved,
      nodesById,
      childrenById,
    );
    childrenContainer.addChild(childContainer);
  }

  container.addChild(childrenContainer);
  return container;
}

function updateRefContainer(
  container: Container,
  node: RefNode,
  prev: RefNode,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
): void {
  // For ref nodes, we rebuild entirely if the component, overrides, or slot content changed
  if (
    node.componentId !== prev.componentId ||
    node.descendants !== prev.descendants ||
    node.slotContent !== prev.slotContent ||
    node.width !== prev.width ||
    node.height !== prev.height
  ) {
    // Remove all children and rebuild
    container.removeChildren();
    const newContainer = createRefContainer(node, nodesById, childrenById);
    // Move all children from new container into existing container
    while (newContainer.children.length > 0) {
      container.addChild(newContainer.children[0]);
    }
    newContainer.destroy();
  }
}
