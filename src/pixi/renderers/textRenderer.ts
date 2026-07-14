import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { TextNode } from "@/types/scene";
import { getPrimarySolidPaint } from "@/utils/fillUtils";
import { getResolvedFill, getResolvedSolidPaint } from "./colorHelpers";
import { applyTextTransform, getLineLimit, truncateLines, wrapTextToLines } from "@/utils/textMeasure";
import { hasActiveList, splitParagraphs } from "@/lib/textLists/paragraphs";
import { layoutTextParagraphs, type LaidOutLine } from "@/utils/textWrap";
import { resolveEffectiveFontWeight } from "@/utils/variableFont";
import { hasEffectiveUnderline, TEXT_LINK_COLOR } from "@/lib/textLink";
import { drawOutlineBBox, isOutlineRenderMode } from "./outlineHelpers";

const TEXT_OUTLINE_BG_LABEL = "text-outline-bg";

/**
 * Label on the wrapper container used by the per-line rendering path
 * (`buildListContent`) — shared by list nodes (bullet/number markers) and
 * plain multi-paragraph nodes with a nonzero `paragraphSpacing`, since both
 * need per-line `Text` objects instead of a single monolithic `Text`
 * (Pixi's own `TextStyle.lineHeight` can't vary line-to-line, which a
 * paragraph gap requires).
 */
const LIST_ROOT_LABEL = "text-list-root";

function isWrappedMode(node: TextNode): boolean {
  return node.textWidthMode === "fixed" || node.textWidthMode === "fixed-height";
}

/**
 * True when the node needs the per-line rendering path (`buildListContent`)
 * rather than the single-`Text` fast path: either it has an active list, or
 * it has a nonzero `paragraphSpacing` across more than one paragraph (a
 * single paragraph has no "after each paragraph" gap to insert).
 */
function needsLineLayout(node: TextNode): boolean {
  if (hasActiveList(node)) return true;
  const spacing = node.paragraphSpacing ?? 0;
  return spacing !== 0 && splitParagraphs(node.text).length > 1;
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
 * Effective text color: the node's own resolved color, falling back to
 * `TEXT_LINK_COLOR` for a linked node with no resolvable color of its own, and
 * to black otherwise.
 */
function getEffectiveTextColor(node: TextNode): string {
  const resolved = getResolvedTextColor(node);
  if (resolved) return resolved;
  // No resolvable color: a linked node falls back to the default link blue
  // (an explicit color, if any, already returned above via `resolved`).
  if (node.link) return TEXT_LINK_COLOR;
  return "#000000";
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
  if (isOutlineRenderMode()) {
    // Outline mode: bounding-box rectangle only — glyph rendering is
    // entirely skipped (bbox is the spec'd minimum for text).
    const gfx = new Graphics();
    gfx.label = TEXT_OUTLINE_BG_LABEL;
    drawOutlineBBox(gfx, node.width, node.height);
    container.addChild(gfx);
    return container;
  }
  if (needsLineLayout(node)) {
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
  if (isOutlineRenderMode()) {
    const gfx = container.getChildByLabel(TEXT_OUTLINE_BG_LABEL) as Graphics;
    if (gfx && (node.width !== prev.width || node.height !== prev.height)) {
      gfx.clear();
      drawOutlineBBox(gfx, node.width, node.height);
    }
    return;
  }

  const nodeIsList = needsLineLayout(node);
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
      node.paragraphSpacing !== prev.paragraphSpacing ||
      node.textTransform !== prev.textTransform ||
      node.textWidthMode !== prev.textWidthMode ||
      node.width !== prev.width ||
      node.height !== prev.height ||
      node.fontSize !== prev.fontSize ||
      node.fontFamily !== prev.fontFamily ||
      node.fontWeight !== prev.fontWeight ||
      node.fontStyle !== prev.fontStyle ||
      node.fontVariations !== prev.fontVariations ||
      node.letterSpacing !== prev.letterSpacing ||
      node.lineHeight !== prev.lineHeight ||
      node.truncateText !== prev.truncateText ||
      node.maxLines !== prev.maxLines ||
      node.textAlign !== prev.textAlign ||
      node.textAlignVertical !== prev.textAlignVertical ||
      node.underline !== prev.underline ||
      node.strikethrough !== prev.strikethrough ||
      node.link !== prev.link ||
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
    node.fontVariations !== prev.fontVariations ||
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
    node.link !== prev.link ||
    node.gradientFill !== prev.gradientFill ||
    node.fills !== prev.fills
  ) {
    textObj.style = buildTextStyle(node);
  }

  positionTextBlock(textObj, node);
  drawTextDecorations(container, textObj, node);
}

/**
 * Per-line rendering path: one Pixi `Text` per wrapped line (instead of a
 * single monolithic `Text`), so each line can carry its own hanging-indent
 * x-offset and, between paragraphs, an extra `paragraphSpacing` y-gap on top
 * of the normal line height — Pixi's own `TextStyle.lineHeight` is uniform
 * across a `Text` object's internal lines, so it can't express that. Also
 * draws one small `Text` per list paragraph for its bullet/number marker.
 * Used whenever `needsLineLayout` is true (an active list, or a nonzero
 * `paragraphSpacing` across multiple paragraphs) — plain single-paragraph (or
 * zero-spacing) text keeps the original single-`Text` fast path via
 * `buildPlainContent`.
 */
function buildListContent(container: Container, node: TextNode): void {
  const root = new Container();
  root.label = LIST_ROOT_LABEL;
  container.addChild(root);

  const fontSize = node.fontSize ?? 16;
  const lineHeightPx = fontSize * (node.lineHeight ?? 1.2);
  const paragraphSpacing = node.paragraphSpacing ?? 0;
  const maxWidth = isWrappedMode(node) ? node.width : null;
  const { lines: laidOutLines, markers } = layoutTextParagraphs(node, maxWidth);

  // Apply the same line limit + ellipsis the plain fast path uses
  // (`buildRenderText`), so a wrapped node with `maxLines`/`truncateText`
  // still truncates on this per-line path. Without this a list or
  // paragraph-spaced node would render every line while
  // `measureTextFixedWidthHeight` shrinks the box to the truncated count —
  // the text would visibly overflow. `getLineLimit` is Infinity in unwrapped
  // ("auto") mode, so this is a no-op there.
  const limit = getLineLimit(node);
  let lines = laidOutLines;
  if (Number.isFinite(limit) && lines.length > limit) {
    const truncatedTexts = truncateLines(node, lines.map((l) => l.text), node.width);
    lines = truncatedTexts.map((text, i) => ({ ...lines[i], text }));
  }

  // Each line's y offset: uniform lineHeightPx within a paragraph, plus one
  // `paragraphSpacing` gap inserted before the first line of every paragraph
  // after the first. `measureTextAutoSize`/`measureTextFixedWidthHeight` and
  // the inline editor's per-paragraph margin-bottom use this same formula so
  // all three can never disagree about where a paragraph gap lands.
  const lineYs: number[] = [];
  let y = 0;
  lines.forEach((line, i) => {
    if (i > 0 && line.paragraphIndex !== lines[i - 1].paragraphIndex) {
      y += paragraphSpacing;
    }
    lineYs.push(y);
    y += lineHeightPx;
  });

  const lineStyle = buildTextStyle(node);
  const fillColor = getEffectiveTextColor(node);
  const dpr = window.devicePixelRatio || 1;

  const lineTexts: Text[] = lines.map((line, i) => {
    const t = new Text({ text: line.text, style: lineStyle });
    t.resolution = dpr;
    t.roundPixels = true;
    t.label = `text-line-${i}`;
    t.anchor.set(0, 0);
    t.x = line.x;
    t.y = lineYs[i];
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
    // A marker whose paragraph's first line was truncated away has no anchor
    // line — skip it rather than stacking it at y=0.
    if (lineIndex < 0) return;
    const t = new Text({ text: marker.text, style: markerStyle });
    t.resolution = dpr;
    t.roundPixels = true;
    t.label = `text-marker-${i}`;
    t.anchor.set(0, 0);
    t.x = marker.x;
    t.y = lineYs[lineIndex];
    root.addChild(t);
  });

  const totalHeight = y;
  if (node.textWidthMode === "fixed-height") {
    const v = node.textAlignVertical ?? "top";
    const factor = v === "middle" ? 0.5 : v === "bottom" ? 1 : 0;
    root.y = (node.height - totalHeight) * factor;
  }

  drawListTextDecorations(root, node, lines, lineTexts, lineYs, fillColor);
}

function drawListTextDecorations(
  root: Container,
  node: TextNode,
  lines: LaidOutLine[],
  lineTexts: Text[],
  lineYs: number[],
  fillColor: string,
): void {
  const underline = hasEffectiveUnderline(node);
  if (!underline && !node.strikethrough) return;

  const g = new Graphics();
  g.label = "text-decorations";
  const fontSize = node.fontSize ?? 16;
  const thickness = Math.max(1, Math.round(fontSize / 14));

  lines.forEach((line, i) => {
    if (!line.text) return;
    const w = lineTexts[i]?.width ?? 0;
    const x = line.x;
    const lineY = lineYs[i];
    if (underline) {
      g.rect(x, lineY + fontSize * 1.05, w, thickness).fill(fillColor);
    }
    if (node.strikethrough) {
      g.rect(x, lineY + fontSize * 0.55, w, thickness).fill(fillColor);
    }
  });

  root.addChild(g);
}

/**
 * Resolve the effective font weight: the `wght` variable-font axis (when set)
 * takes precedence over the static `fontWeight` field, since a variable font's
 * `wght` value (e.g. 530) is a strictly finer-grained version of the same
 * concept. Canvas/Pixi text has no `font-variation-settings` support, so
 * `wght` is the only axis that can be approximated here — the DOM-rendered
 * paths (`designToHtml`, `InlineTextEditor`) get full-fidelity variation
 * settings including the other axes (`wdth`/`slnt`/`opsz`/...).
 */
function resolveFontWeight(node: TextNode): string {
  return resolveEffectiveFontWeight(node.fontVariations, node.fontWeight);
}

export function buildTextStyle(node: TextNode): TextStyle {
  const fillColor = getEffectiveTextColor(node);
  const fontSize = node.fontSize ?? 16;
  const lineHeightMultiplier = node.lineHeight ?? 1.2;

  return new TextStyle({
    fontFamily: node.fontFallback
      ? [node.fontFamily || "Arial", node.fontFallback]
      : node.fontFamily || "Arial",
    fontSize: fontSize,
    fontWeight: resolveFontWeight(node) as TextStyle["fontWeight"],
    fontStyle: (node.fontStyle as TextStyle["fontStyle"]) ?? "normal",
    // `node.fontFeatures` (OpenType feature tags) is intentionally not
    // applied here. Pixi's `TextStyle.fontVariant` can request canvas
    // `font-variant: small-caps`, which *parses* — but verified in-browser
    // this renders as a plain uppercase substitution (full cap-height, no
    // reduced-size small-caps glyphs), which would misrepresent the
    // feature rather than approximate it. So every curated feature is a
    // documented no-op in Pixi; the DOM-rendered `InlineTextEditor` and
    // HTML/CSS export apply the real `font-feature-settings` string and get
    // correct glyphs wherever the loaded font actually implements them.
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
  const underline = hasEffectiveUnderline(node);
  if (!underline && !node.strikethrough) {
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

  const fillColor = getEffectiveTextColor(node);
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

    if (underline) {
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
