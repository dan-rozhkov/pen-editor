import { Container, Text, TextStyle } from "pixi.js";
import type { TextNode } from "@/types/scene";
import { getResolvedFill } from "./colorHelpers";

export function createTextContainer(node: TextNode): Container {
  const container = new Container();
  const text = new Text({
    text: node.text,
    style: buildTextStyle(node),
  });
  text.resolution = window.devicePixelRatio || 1;
  text.label = "text-content";
  text.anchor.set(0, 0);
  container.addChild(text);
  return container;
}

export function updateTextContainer(
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
