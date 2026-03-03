import { applyTextTransform } from "@/utils/textMeasure";
import type { TextTransform } from "@/types/scene";

/** Cached grapheme segmenter for letter-spacing rendering */
const graphemeSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

/** Draw a text node onto the canvas using Range.getClientRects for line-accurate positioning */
export function drawTextNode(
  ctx: CanvasRenderingContext2D,
  textNode: Text,
  parentStyle: CSSStyleDeclaration,
  containerRect: DOMRect,
): void {
  const text = textNode.textContent;
  if (!text || !text.trim()) return;

  ctx.fillStyle = parentStyle.color;
  ctx.font = `${parentStyle.fontStyle} ${parentStyle.fontWeight} ${parentStyle.fontSize} ${parentStyle.fontFamily}`;

  // Use Range API to get per-line rects for wrapped text
  const range = document.createRange();
  range.selectNodeContents(textNode);
  const allRects = range.getClientRects();

  if (allRects.length === 0) return;
  const fontSizePx = parseFloat(parentStyle.fontSize) || 16;
  const preserveWhitespace = parentStyle.whiteSpace.startsWith("pre");

  // For multi-line (wrapped) text, find which characters belong to which line
  // by binary searching through character offsets
  const lines = extractLinesFromRects(textNode, allRects, containerRect, preserveWhitespace);
  const textTransform = parentStyle.textTransform;
  const parsedLetterSpacing = parseFloat(parentStyle.letterSpacing);
  const letterSpacingPx = Number.isFinite(parsedLetterSpacing) ? parsedLetterSpacing : 0;
  for (const line of lines) {
    drawTextInLineBox(
      ctx,
      applyTextTransform(line.text, textTransform as TextTransform),
      line.x,
      line.y,
      line.height,
      fontSizePx,
      letterSpacingPx,
    );
  }
}

interface TextLine {
  text: string;
  x: number;
  y: number;
  height: number;
}

function drawTextInLineBox(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  lineTop: number,
  lineHeight: number,
  fontSizePx: number,
  letterSpacingPx: number,
): void {
  // Use font/em box metrics (not glyph box) to match CSS line box positioning.
  const refMetrics = ctx.measureText("Mg");
  const ascent =
    refMetrics.fontBoundingBoxAscent ||
    refMetrics.emHeightAscent ||
    fontSizePx * 0.8;
  const descent =
    refMetrics.fontBoundingBoxDescent ||
    refMetrics.emHeightDescent ||
    fontSizePx * 0.2;
  const fontBoxHeight = Math.max(1, ascent + descent);
  const extraLeading = Math.max(0, lineHeight - fontBoxHeight);
  const baselineY = lineTop + extraLeading / 2 + ascent;

  ctx.textBaseline = "alphabetic";
  if (letterSpacingPx === 0) {
    ctx.fillText(text, x, baselineY);
    return;
  }

  let cursorX = x;
  const graphemes = graphemeSegmenter
    ? [...graphemeSegmenter.segment(text)].map((s) => s.segment)
    : Array.from(text);

  for (let i = 0; i < graphemes.length; i++) {
    const grapheme = graphemes[i];
    ctx.fillText(grapheme, cursorX, baselineY);
    cursorX += ctx.measureText(grapheme).width;
    if (i < graphemes.length - 1) cursorX += letterSpacingPx;
  }
}


/** Extract per-line text and positions from a text node with multiple client rects */
function extractLinesFromRects(
  textNode: Text,
  rects: DOMRectList,
  containerRect: DOMRect,
  preserveWhitespace: boolean,
): TextLine[] {
  const lines: TextLine[] = [];
  const text = textNode.textContent ?? "";
  const range = document.createRange();

  // Group rects by unique Y position (each line has a distinct top)
  const lineYs: number[] = [];
  const lineHeights: number[] = [];
  for (let i = 0; i < rects.length; i++) {
    const top = Math.round(rects[i].top);
    const h = rects[i].height;
    const existingIdx = lineYs.findIndex((lineTop) => Math.abs(lineTop - top) <= 2);
    if (existingIdx === -1) {
      lineYs.push(top);
      lineHeights.push(h);
    } else {
      lineHeights[existingIdx] = Math.max(lineHeights[existingIdx], h);
    }
  }

  // For each line, find the character range using binary search
  let charStart = 0;
  for (let lineIdx = 0; lineIdx < lineYs.length; lineIdx++) {
    const lineY = lineYs[lineIdx];
    const isLast = lineIdx === lineYs.length - 1;
    let charEnd = text.length;

    if (!isLast) {
      // Binary search for where the next line starts
      let lo = charStart;
      let hi = text.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        range.setStart(textNode, mid);
        range.setEnd(textNode, mid + 1);
        const midRect = range.getBoundingClientRect();
        if (Math.round(midRect.top) > lineY + 2) {
          hi = mid;
        } else {
          lo = mid + 1;
        }
      }
      charEnd = lo;
    }

    let drawStart = charStart;
    let drawEnd = charEnd;

    if (!preserveWhitespace) {
      while (drawStart < drawEnd && /\s/.test(text[drawStart])) drawStart++;
      while (drawEnd > drawStart && /\s/.test(text[drawEnd - 1])) drawEnd--;
    }

    if (drawStart < drawEnd) {
      let lineText = text.slice(drawStart, drawEnd);
      if (!preserveWhitespace) {
        lineText = lineText.replace(/\s+/g, " ");
      }

      if (!lineText) {
        charStart = charEnd;
        continue;
      }

      // Get position of first char in this line
      range.setStart(textNode, drawStart);
      range.setEnd(textNode, Math.min(drawStart + 1, text.length));
      const firstCharRect = range.getBoundingClientRect();

      lines.push({
        text: lineText,
        x: firstCharRect.left - containerRect.left,
        y: firstCharRect.top - containerRect.top,
        height: lineHeights[lineIdx] ?? firstCharRect.height,
      });
    }

    charStart = charEnd;
  }

  return lines;
}
