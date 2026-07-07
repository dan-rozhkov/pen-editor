import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { TextNode } from "@/types/scene";
import { getPrimarySolidPaint } from "@/utils/fillUtils";
import { getResolvedFill, getResolvedSolidPaint } from "./colorHelpers";
import { applyTextTransform, truncateLines, wrapTextToLines } from "@/utils/textMeasure";
import { hasActiveList } from "@/lib/textLists/paragraphs";
import { layoutTextParagraphs, type LaidOutLine } from "@/utils/textWrap";

/** Label on the wrapper container used by the list-rendering path (see `buildListContent`). */
const LIST_ROOT_LABEL = "text-list-root";

function isWrappedMode(node: TextNode): boolean {
  return node.textWidthMode === "fixed" || node.textWidthMode === "fixed-height";
}

/**
 * Resolve the text color. Text supports only a single solid color: when a paint
 * stack is present, use the topmost visible solid paint (resolving its binding +
 * opacity); otherwise fall back to the legacy resolved fill.
 */
function getResolvedTextColor(node: TextNode): string | undefined {
  if (node.fills) {
    const paint = getPrimarySolidPaint(node);
    return paint ? getResolvedSolidPaint(paint) : undefined;
  }
  return getResolvedFill(node);
}

/**
 * The string fed to the Pixi Text object. For wrapped modes we pre-wrap with the
 * shared `wrapTextToLines` so the canvas pixels match measurement exactly, and we
 * disable Pixi's own word-wrapper.
 */
function buildRenderText(node: TextNode): string {
  const transformed = applyTextTransform(node.text, node.textTransform);
  if (!isWrappedMode(node)) return transformed;
  const lines = wrapTextToLines(node, node.width);
  return truncateLines(node, lines, node.width).join("\n");
}

function buildPlainContent(container: Container, node: TextNode): void {
  const text = new Text({
    text: buildRenderText(node),
    style: buildTextStyle(node),
  });
  text.resolution = window.devicePixelRatio || 1;
  text.roundPixels = true;
  text.label = "text-content";
  text.anchor.set(0, 0);
  container.addChild(text);
  positionTextBlock(text, node);
  drawTextDecorations(container, text, node);
}

export function createTextContainer(node: TextNode): Container {
  const container = new Container();
  if (hasActiveList(node)) {
    buildListContent(container, node);
  } else {
    buildPlainContent(container, node);
  }
  return container;
}

export function updateTextContainer(
  container: Container,
  node: TextNode,
  prev: TextNode,
): void {
  const nodeIsList = hasActiveList(node);
  const wasList = container.getChildByLabel(LIST_ROOT_LABEL) != null;

  // Mode transition (plain <-> list): list layout depends on many interacting
  // fields (markers, wrapping, indent) in a way that isn't worth diffing
  // incrementally like the plain path below, so a full rebuild is fine here.
  // While staying in list mode, though, this runs on *every* node-object
  // change — including position-only drag ticks and every resize tick — so it
  // must be gated the same way the plain path gates its own rebuild/restyle
  // below: only rebuild when a field that actually affects list layout or
  // appearance changed (text/paragraphs, wrap width, font/style, alignment,
  // color, decorations). x/y-only updates must skip entirely.
  if (nodeIsList || wasList) {
    const modeChanged = nodeIsList !== wasList;
    const listContentChanged =
      modeChanged ||
      node.text !== prev.text ||
      node.paragraphs !== prev.paragraphs ||
      node.textTransform !== prev.textTransform ||
      node.textWidthMode !== prev.textWidthMode ||
      node.width !== prev.width ||
      node.height !== prev.height ||
      node.fontSize !== prev.fontSize ||
      node.fontFamily !== prev.fontFamily ||
      node.fontWeight !== prev.fontWeight ||
      node.fontStyle !== prev.fontStyle ||
      node.letterSpacing !== prev.letterSpacing ||
      node.lineHeight !== prev.lineHeight ||
      node.truncateText !== prev.truncateText ||
      node.maxLines !== prev.maxLines ||
      node.textAlign !== prev.textAlign ||
      node.textAlignVertical !== prev.textAlignVertical ||
      node.underline !== prev.underline ||
      node.strikethrough !== prev.strikethrough ||
      node.fill !== prev.fill ||
      node.fillBinding !== prev.fillBinding ||
      node.fillOpacity !== prev.fillOpacity ||
      node.fills !== prev.fills;

    if (!listContentChanged) return;

    for (const child of [...container.children]) {
      container.removeChild(child);
      child.destroy();
    }
    if (nodeIsList) {
      buildListContent(container, node);
    } else {
      buildPlainContent(container, node);
    }
    return;
  }

  const textObj = container.getChildByLabel("text-content") as Text;
  if (!textObj) return;

  // Properties that change the wrapped/rendered string.
  const textChanged =
    node.text !== prev.text ||
    node.textTransform !== prev.textTransform ||
    node.textWidthMode !== prev.textWidthMode ||
    node.width !== prev.width ||
    node.fontSize !== prev.fontSize ||
    node.fontFamily !== prev.fontFamily ||
    node.fontWeight !== prev.fontWeight ||
    node.fontStyle !== prev.fontStyle ||
    node.letterSpacing !== prev.letterSpacing ||
    node.lineHeight !== prev.lineHeight ||
    node.truncateText !== prev.truncateText ||
    node.maxLines !== prev.maxLines ||
    node.height !== prev.height;

  if (textChanged) {
    textObj.text = buildRenderText(node);
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
    node.gradientFill !== prev.gradientFill ||
    node.fills !== prev.fills
  ) {
    textObj.style = buildTextStyle(node);
  }

  positionTextBlock(textObj, node);
  drawTextDecorations(container, textObj, node);
}

/**
 * List-rendering path: one Pixi `Text` per wrapped line (instead of a single
 * monolithic `Text`), so each line can carry its own hanging-indent x-offset,
 * plus one small `Text` per list paragraph for its bullet/number marker.
 * Used only when the node has at least one active list paragraph — plain
 * text keeps the original single-`Text` fast path via `buildPlainContent`.
 */
function buildListContent(container: Container, node: TextNode): void {
  const root = new Container();
  root.label = LIST_ROOT_LABEL;
  container.addChild(root);

  const fontSize = node.fontSize ?? 16;
  const lineHeightPx = fontSize * (node.lineHeight ?? 1.2);
  const maxWidth = isWrappedMode(node) ? node.width : null;
  const { lines, markers } = layoutTextParagraphs(node, maxWidth);

  const lineStyle = buildTextStyle(node);
  const fillColor = getResolvedTextColor(node) ?? "#000000";
  const dpr = window.devicePixelRatio || 1;

  const lineTexts: Text[] = lines.map((line, i) => {
    const t = new Text({ text: line.text, style: lineStyle });
    t.resolution = dpr;
    t.roundPixels = true;
    t.label = `text-line-${i}`;
    t.anchor.set(0, 0);
    t.x = line.x;
    t.y = i * lineHeightPx;
    root.addChild(t);
    return t;
  });

  // Markers never wrap/align like body text — always left-anchored at their
  // own x, single style copy shared across all of them.
  const markerStyle = new TextStyle({ ...lineStyle, align: "left" });
  markers.forEach((marker, i) => {
    const lineIndex = lines.findIndex(
      (l) => l.paragraphIndex === marker.paragraphIndex && l.isFirstLine,
    );
    const t = new Text({ text: marker.text, style: markerStyle });
    t.resolution = dpr;
    t.roundPixels = true;
    t.label = `text-marker-${i}`;
    t.anchor.set(0, 0);
    t.x = marker.x;
    t.y = lineIndex >= 0 ? lineIndex * lineHeightPx : 0;
    root.addChild(t);
  });

  const totalHeight = lines.length * lineHeightPx;
  if (node.textWidthMode === "fixed-height") {
    const v = node.textAlignVertical ?? "top";
    const factor = v === "middle" ? 0.5 : v === "bottom" ? 1 : 0;
    root.y = (node.height - totalHeight) * factor;
  }

  drawListTextDecorations(root, node, lines, lineTexts, lineHeightPx, fillColor);
}

function drawListTextDecorations(
  root: Container,
  node: TextNode,
  lines: LaidOutLine[],
  lineTexts: Text[],
  lineHeightPx: number,
  fillColor: string,
): void {
  if (!node.underline && !node.strikethrough) return;

  const g = new Graphics();
  g.label = "text-decorations";
  const fontSize = node.fontSize ?? 16;
  const thickness = Math.max(1, Math.round(fontSize / 14));

  lines.forEach((line, i) => {
    if (!line.text) return;
    const w = lineTexts[i]?.width ?? 0;
    const x = line.x;
    if (node.underline) {
      g.rect(x, i * lineHeightPx + fontSize * 1.05, w, thickness).fill(fillColor);
    }
    if (node.strikethrough) {
      g.rect(x, i * lineHeightPx + fontSize * 0.55, w, thickness).fill(fillColor);
    }
  });

  root.addChild(g);
}

export function buildTextStyle(node: TextNode): TextStyle {
  const fillColor = getResolvedTextColor(node) ?? "#000000";
  const fontSize = node.fontSize ?? 16;
  const lineHeightMultiplier = node.lineHeight ?? 1.2;

  return new TextStyle({
    fontFamily: node.fontFamily || "Arial",
    fontSize: fontSize,
    fontWeight: (node.fontWeight as TextStyle["fontWeight"]) ?? "normal",
    fontStyle: (node.fontStyle as TextStyle["fontStyle"]) ?? "normal",
    fill: fillColor,
    // Lines are pre-wrapped via wrapTextToLines, so disable Pixi's own wrapper.
    wordWrap: false,
    align: node.textAlign ?? "left",
    lineHeight: fontSize * lineHeightMultiplier,
    letterSpacing: node.letterSpacing ?? 0,
  });
}

/**
 * Position the text block inside the node rect.
 *
 * Horizontal: Pixi's `align` only aligns lines relative to each other, not within
 * the box, so for wrapped center/right we shift the block to the right edge of the
 * node (the block's internal width spans node.width because the longest line wraps
 * to fill it, but for short content we still want the block flush to the box).
 *
 * Vertical: `textAlignVertical` is honoured for fixed-size mode; overflow renders
 * outside the node (negative / past-bottom offsets are allowed, never clipped).
 */
function positionTextBlock(textObj: Text, node: TextNode): void {
  let x = 0;
  let y = 0;

  if (isWrappedMode(node)) {
    const align = node.textAlign ?? "left";
    const blockWidth = textObj.width;
    if (align === "center") x = (node.width - blockWidth) / 2;
    else if (align === "right") x = node.width - blockWidth;

    if (node.textWidthMode === "fixed-height") {
      const contentHeight = textObj.height;
      const v = node.textAlignVertical ?? "top";
      const factor = v === "middle" ? 0.5 : v === "bottom" ? 1 : 0;
      y = (node.height - contentHeight) * factor;
    }
  }

  textObj.x = x;
  textObj.y = y;
}

function drawTextDecorations(
  container: Container,
  textObj: Text,
  node: TextNode,
): void {
  const existing = container.getChildByLabel("text-decorations") as Graphics | null;
  if (!node.underline && !node.strikethrough) {
    if (existing) {
      container.removeChild(existing);
      existing.destroy();
    }
    return;
  }

  const g = existing ?? new Graphics();
  g.label = "text-decorations";
  g.clear();
  g.x = textObj.x;
  g.y = textObj.y;

  const fillColor = getResolvedTextColor(node) ?? "#000000";
  const fontSize = node.fontSize ?? 16;
  const lineHeightMultiplier = node.lineHeight ?? 1.2;
  const lineHeight = fontSize * lineHeightMultiplier;
  const thickness = Math.max(1, Math.round(fontSize / 14));
  const textWidth = textObj.width;
  const textHeight = textObj.height;
  const lineCount = Math.max(1, Math.round(textHeight / lineHeight));

  for (let i = 0; i < lineCount; i++) {
    const lineY = i * lineHeight;
    // For the last line, use remaining height to compute actual line width
    // For single-line text, just use textWidth
    const w = textWidth;

    if (node.underline) {
      const y = lineY + fontSize * 1.05;
      g.rect(0, y, w, thickness).fill(fillColor);
    }

    if (node.strikethrough) {
      const y = lineY + fontSize * 0.55;
      g.rect(0, y, w, thickness).fill(fillColor);
    }
  }

  if (!existing) container.addChild(g);
}
