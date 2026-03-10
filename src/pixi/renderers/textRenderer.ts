import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { TextNode } from "@/types/scene";
import { getResolvedFill } from "./colorHelpers";
import { applyTextTransform } from "@/utils/textMeasure";

export function createTextContainer(node: TextNode): Container {
  const container = new Container();
  const text = new Text({
    text: applyTextTransform(node.text, node.textTransform),
    style: buildTextStyle(node),
  });
  text.resolution = window.devicePixelRatio || 1;
  text.roundPixels = true;
  text.label = "text-content";
  text.anchor.set(0, 0);
  container.addChild(text);
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

  if (node.text !== prev.text || node.textTransform !== prev.textTransform) {
    textObj.text = applyTextTransform(node.text, node.textTransform);
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

  drawTextDecorations(container, textObj, node);
}

export function buildTextStyle(node: TextNode): TextStyle {
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

function drawTextDecorations(
  container: Container,
  textObj: Text,
  node: TextNode,
): void {
  const existing = container.getChildByLabel("text-decorations") as Graphics | null;
  if (!node.underline && !node.strikethrough) {
    if (existing) container.removeChild(existing);
    return;
  }

  const g = existing ?? new Graphics();
  g.label = "text-decorations";
  g.clear();

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
