import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { TextNode } from "@/types/scene";
import { getResolvedFill } from "./colorHelpers";
import { applyTextTransform, wrapTextToLines } from "@/utils/textMeasure";

function isWrappedMode(node: TextNode): boolean {
  return node.textWidthMode === "fixed" || node.textWidthMode === "fixed-height";
}

/**
 * The string fed to the Pixi Text object. For wrapped modes we pre-wrap with the
 * shared `wrapTextToLines` so the canvas pixels match measurement exactly, and we
 * disable Pixi's own word-wrapper.
 */
function buildRenderText(node: TextNode): string {
  const transformed = applyTextTransform(node.text, node.textTransform);
  if (!isWrappedMode(node)) return transformed;
  return wrapTextToLines(node, node.width).join("\n");
}

export function createTextContainer(node: TextNode): Container {
  const container = new Container();
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
  return container;
}

export function updateTextContainer(
  container: Container,
  node: TextNode,
  prev: TextNode,
): void {
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
    node.letterSpacing !== prev.letterSpacing;

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
    node.gradientFill !== prev.gradientFill
  ) {
    textObj.style = buildTextStyle(node);
  }

  positionTextBlock(textObj, node);
  drawTextDecorations(container, textObj, node);
}

export function buildTextStyle(node: TextNode): TextStyle {
  const fillColor = getResolvedFill(node) ?? "#000000";
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

  const fillColor = getResolvedFill(node) ?? "#000000";
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
