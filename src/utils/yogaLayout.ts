/**
 * Pure TypeScript flexbox layout engine.
 * Replaces yoga-layout (WASM) with a zero-dependency implementation
 * supporting: direction, gap (+ per-axis rowGap/columnGap), flex-wrap,
 * padding, align-items, justify-content, flex-grow/shrink, sizing modes
 * (fixed, fill_container, fit_content), and per-child min/max width/height
 * clamps.
 */

import type {
  SceneNode,
  FrameNode,
  GroupNode,
  TextNode,
  AlignItems,
  JustifyContent,
} from "../types/scene";
import {
  measureTextAutoSize,
  measureTextFixedWidthHeight,
} from "./textMeasure";

// ── Internal types ──────────────────────────────────────────────────────────

type SizingMode = "fixed" | "fill_container" | "fit_content";

interface FlexItem {
  id: string;
  mainSizeMode: SizingMode;
  crossSizeMode: SizingMode;
  mainBaseSize: number;
  crossBaseSize: number;
  flexGrow: number;
  flexShrink: number;
  flexBasis: number;
  alignSelf: AlignItems | null;
  // Min/max clamps (main/cross axis, already oriented for the container direction)
  mainMin?: number;
  mainMax?: number;
  crossMin?: number;
  crossMax?: number;
  // Computed output
  computedMainSize: number;
  computedCrossSize: number;
  mainPos: number;
  crossPos: number;
}

interface FlexContainer {
  direction: "row" | "column";
  mainSize: number | undefined; // undefined = shrink-to-fit
  crossSize: number | undefined;
  // Gap between items along the main axis (within a line)
  mainGap: number;
  // Gap between lines along the cross axis (only relevant when flexWrap is set)
  crossGap: number;
  flexWrap: boolean;
  padding: [number, number, number, number]; // [top, right, bottom, left]
  alignItems: AlignItems;
  justifyContent: JustifyContent;
}

function clamp(value: number, min?: number, max?: number): number {
  let v = value;
  if (min !== undefined) v = Math.max(v, min);
  if (max !== undefined) v = Math.min(v, max);
  return v;
}

interface ResolvedPadding {
  mainStart: number;
  mainEnd: number;
  crossStart: number;
  crossEnd: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function resolvePadding(container: FlexContainer): ResolvedPadding {
  const [top, right, bottom, left] = container.padding;
  if (container.direction === "row") {
    return {
      mainStart: left,
      mainEnd: right,
      crossStart: top,
      crossEnd: bottom,
    };
  } else {
    return {
      mainStart: top,
      mainEnd: bottom,
      crossStart: left,
      crossEnd: right,
    };
  }
}

function buildContainer(
  frame: FrameNode,
  options?: { fitWidth?: boolean; fitHeight?: boolean },
): FlexContainer {
  const layout = frame.layout;
  const direction = layout?.flexDirection ?? "row";
  const isHorizontal = direction === "row";
  const fitWidth = options?.fitWidth ?? false;
  const fitHeight = options?.fitHeight ?? false;

  const gap = layout?.gap ?? 0;
  const rowGap = layout?.rowGap ?? gap;
  const columnGap = layout?.columnGap ?? gap;
  // Main axis = between items in the same line; cross axis = between lines.
  const mainGap = isHorizontal ? columnGap : rowGap;
  const crossGap = isHorizontal ? rowGap : columnGap;

  return {
    direction,
    mainSize: isHorizontal
      ? fitWidth
        ? undefined
        : frame.width
      : fitHeight
        ? undefined
        : frame.height,
    crossSize: isHorizontal
      ? fitHeight
        ? undefined
        : frame.height
      : fitWidth
        ? undefined
        : frame.width,
    mainGap,
    crossGap,
    flexWrap: layout?.flexWrap ?? false,
    padding: [
      layout?.paddingTop ?? 0,
      layout?.paddingRight ?? 0,
      layout?.paddingBottom ?? 0,
      layout?.paddingLeft ?? 0,
    ],
    alignItems: layout?.alignItems ?? "flex-start",
    justifyContent: layout?.justifyContent ?? "flex-start",
  };
}

/**
 * Resolve effective size for a child, handling fit_content recursion
 * for nested auto-layout frames.
 */
function resolveEffectiveSize(
  child: SceneNode,
  widthMode: SizingMode,
  heightMode: SizingMode,
): { width: number; height: number } {
  let effectiveWidth = child.width;
  let effectiveHeight = child.height;

  if (child.type === "frame") {
    const frame = child as FrameNode;
    const needsIntrinsic =
      (widthMode === "fit_content" || heightMode === "fit_content") &&
      frame.layout?.autoLayout &&
      frame.children.length > 0;

    if (needsIntrinsic) {
      const intrinsic = computeIntrinsicSize(frame);
      if (widthMode === "fit_content") effectiveWidth = intrinsic.width;
      if (heightMode === "fit_content") effectiveHeight = intrinsic.height;
    }
  } else if (child.type === "text") {
    const textNode = child as TextNode;
    const textMode = textNode.textWidthMode ?? "auto";

    if (widthMode === "fit_content" || heightMode === "fit_content") {
      if (textMode === "fixed") {
        // Fixed width, auto height — measure wrapped text height
        if (heightMode === "fit_content") {
          effectiveHeight = measureTextFixedWidthHeight(textNode);
        }
      } else {
        // Auto mode — measure both dimensions from content
        const measured = measureTextAutoSize(textNode);
        if (widthMode === "fit_content") effectiveWidth = measured.width;
        if (heightMode === "fit_content") effectiveHeight = measured.height;
      }
    }
  } else if (child.type === "group") {
    // A group has no independent size: its extent is the bounding box of its
    // VISIBLE children. The stored width/height is a stale snapshot (set once
    // at creation and never updated on visibility changes), so always recompute
    // it here — otherwise hiding a node inside a group would not shrink an
    // auto-layout ancestor. Always recompute regardless of sizing mode.
    const size = computeGroupIntrinsicSize(child as GroupNode);
    effectiveWidth = size.width;
    effectiveHeight = size.height;
  }

  return { width: effectiveWidth, height: effectiveHeight };
}

/**
 * Intrinsic (shrink-wrap) size of a group: the tight bounding box of its
 * visible children, mirroring how `groupNodes` computes group bounds at
 * creation (maxX - minX, maxY - minY). Child positions are relative to the
 * group origin. Recurses through resolveEffectiveSize so nested groups,
 * fit_content frames, and text children contribute their live sizes.
 * No visible children => zero extent (the group contributes nothing but still
 * occupies its flow slot in an auto-layout parent).
 */
function computeGroupIntrinsicSize(group: GroupNode): {
  width: number;
  height: number;
} {
  const children = Array.isArray(group.children) ? group.children : [];
  const visible = children.filter(
    (c) => c.visible !== false && c.enabled !== false,
  );
  if (visible.length === 0) return { width: 0, height: 0 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of visible) {
    const widthMode: SizingMode = c.sizing?.widthMode ?? "fixed";
    const heightMode: SizingMode = c.sizing?.heightMode ?? "fixed";
    const { width, height } = resolveEffectiveSize(c, widthMode, heightMode);
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x + width);
    maxY = Math.max(maxY, c.y + height);
  }

  return { width: maxX - minX, height: maxY - minY };
}

function buildFlexItem(child: SceneNode, container: FlexContainer): FlexItem {
  const isHorizontal = container.direction === "row";

  const widthMode: SizingMode = child.sizing?.widthMode ?? "fixed";
  const heightMode: SizingMode = child.sizing?.heightMode ?? "fixed";

  const mainSizeMode = isHorizontal ? widthMode : heightMode;
  const crossSizeMode = isHorizontal ? heightMode : widthMode;

  const { width: effectiveWidth, height: effectiveHeight } =
    resolveEffectiveSize(child, widthMode, heightMode);

  const sizing = child.sizing;
  const mainMin = isHorizontal ? sizing?.minWidth : sizing?.minHeight;
  const mainMax = isHorizontal ? sizing?.maxWidth : sizing?.maxHeight;
  const crossMin = isHorizontal ? sizing?.minHeight : sizing?.minWidth;
  const crossMax = isHorizontal ? sizing?.maxHeight : sizing?.maxWidth;

  const mainBaseSize = clamp(
    isHorizontal ? effectiveWidth : effectiveHeight,
    mainMin,
    mainMax,
  );
  const crossBaseSize = clamp(
    isHorizontal ? effectiveHeight : effectiveWidth,
    crossMin,
    crossMax,
  );

  let flexGrow = 0;
  let flexShrink = 0;
  let flexBasis = mainBaseSize;
  let alignSelf: AlignItems | null = null;

  if (mainSizeMode === "fill_container") {
    flexGrow = 1;
    flexShrink = 1;
    flexBasis = 0;
  }

  if (crossSizeMode === "fill_container") {
    alignSelf = "stretch";
  }

  return {
    id: child.id,
    mainSizeMode,
    crossSizeMode,
    mainBaseSize,
    crossBaseSize,
    flexGrow,
    flexShrink,
    flexBasis,
    alignSelf,
    mainMin,
    mainMax,
    crossMin,
    crossMax,
    computedMainSize: 0,
    computedCrossSize: 0,
    mainPos: 0,
    crossPos: 0,
  };
}

// ── Algorithm phases ────────────────────────────────────────────────────────

/**
 * Phase 1: Resolve main-axis sizes via flex-grow / flex-shrink distribution.
 */
function resolveMainAxisSizes(
  items: FlexItem[],
  container: FlexContainer,
): void {
  const pad = resolvePadding(container);
  const totalGap =
    items.length > 1 ? container.mainGap * (items.length - 1) : 0;

  if (container.mainSize !== undefined) {
    const contentSpace = container.mainSize - pad.mainStart - pad.mainEnd;
    const totalBasis = items.reduce((sum, item) => sum + item.flexBasis, 0);
    const freeSpace = contentSpace - totalBasis - totalGap;

    if (freeSpace > 0) {
      const totalGrow = items.reduce((sum, item) => sum + item.flexGrow, 0);
      if (totalGrow > 0) {
        const growUnit = freeSpace / totalGrow;
        for (const item of items) {
          item.computedMainSize = item.flexBasis + item.flexGrow * growUnit;
        }
      } else {
        for (const item of items) {
          item.computedMainSize = item.flexBasis;
        }
      }
    } else if (freeSpace < 0) {
      const totalShrink = items.reduce(
        (sum, item) => sum + item.flexShrink * item.flexBasis,
        0,
      );
      if (totalShrink > 0) {
        for (const item of items) {
          const shrinkRatio = (item.flexShrink * item.flexBasis) / totalShrink;
          item.computedMainSize = Math.max(
            0,
            item.flexBasis + freeSpace * shrinkRatio,
          );
        }
      } else {
        for (const item of items) {
          item.computedMainSize = item.flexBasis;
        }
      }
    } else {
      for (const item of items) {
        item.computedMainSize = item.flexBasis;
      }
    }
  } else {
    // Intrinsic mode: each item gets its basis
    for (const item of items) {
      item.computedMainSize = item.flexBasis;
    }
  }

  // Clamp grow/shrink results into the item's min/max range. This is a
  // single-pass clamp (not a full iterative CSS flex-basis redistribution) —
  // acceptable simplification: it can leave a little free/negative space when
  // clamped items exist alongside grow/shrink siblings, but keeps every
  // computed size within its configured bounds.
  for (const item of items) {
    item.computedMainSize = clamp(item.computedMainSize, item.mainMin, item.mainMax);
  }
}

/**
 * Split items into wrapped lines based on their hypothetical (flex-basis)
 * main-axis size. When wrap is off, or the main axis has no fixed size to
 * wrap within (shrink-to-fit), everything stays on a single line — this is
 * the pre-wrap behavior and keeps single-line layouts byte-for-byte
 * unchanged.
 */
function layoutLines(
  items: FlexItem[],
  container: FlexContainer,
): FlexItem[][] {
  if (items.length === 0) return [];
  if (!container.flexWrap || container.mainSize === undefined) {
    return [items];
  }

  const pad = resolvePadding(container);
  const contentMain = container.mainSize - pad.mainStart - pad.mainEnd;

  const lines: FlexItem[][] = [];
  let current: FlexItem[] = [];
  let currentMain = 0;

  for (const item of items) {
    const itemMain = item.flexBasis;
    if (
      current.length > 0 &&
      currentMain + container.mainGap + itemMain > contentMain
    ) {
      lines.push(current);
      current = [item];
      currentMain = itemMain;
    } else {
      currentMain += current.length > 0 ? container.mainGap + itemMain : itemMain;
      current.push(item);
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

/** Natural (unstretched) cross size of a line: the max crossBaseSize in it. */
function lineNaturalCrossSize(line: FlexItem[]): number {
  return line.length > 0
    ? Math.max(...line.map((item) => item.crossBaseSize))
    : 0;
}

/**
 * Resolve the cross-axis size of each line. Single line: mirrors the old
 * (pre-wrap) resolveCrossAxisSizes contentCrossSpace exactly, so stretch
 * behavior is unchanged when wrap is off. Multi-line with a fixed container
 * cross size: distributes leftover space evenly across lines (basic
 * align-content: stretch equivalent). Multi-line with no fixed cross size:
 * each line keeps its natural size (the container hugs the summed lines).
 */
function resolveLineCrossSizes(
  lines: FlexItem[][],
  container: FlexContainer,
): number[] {
  const naturals = lines.map(lineNaturalCrossSize);

  if (lines.length <= 1) {
    if (container.crossSize !== undefined) {
      const pad = resolvePadding(container);
      return [container.crossSize - pad.crossStart - pad.crossEnd];
    }
    return naturals;
  }

  if (container.crossSize === undefined) return naturals;

  const pad = resolvePadding(container);
  const contentCross = container.crossSize - pad.crossStart - pad.crossEnd;
  const totalGap = (lines.length - 1) * container.crossGap;
  const totalNatural = naturals.reduce((sum, n) => sum + n, 0);
  const freeSpace = Math.max(0, contentCross - totalNatural - totalGap);
  const extra = freeSpace / lines.length;
  return naturals.map((n) => n + extra);
}

/**
 * Phase 2: Resolve cross-axis sizes (stretch vs base size), per line, and
 * clamp into each item's min/max cross range.
 */
function assignLineCrossSizes(
  lines: FlexItem[][],
  lineCrossSizes: number[],
  container: FlexContainer,
): void {
  for (let li = 0; li < lines.length; li++) {
    const lineCrossSize = lineCrossSizes[li];
    for (const item of lines[li]) {
      const effectiveAlign = item.alignSelf ?? container.alignItems;
      item.computedCrossSize =
        effectiveAlign === "stretch" ? lineCrossSize : item.crossBaseSize;
      item.computedCrossSize = clamp(
        item.computedCrossSize,
        item.crossMin,
        item.crossMax,
      );
    }
  }
}

/**
 * Phase 3: Position items on the main axis (justify-content).
 */
function positionMainAxis(items: FlexItem[], container: FlexContainer): void {
  if (items.length === 0) return;

  const pad = resolvePadding(container);
  const totalGap =
    items.length > 1 ? container.mainGap * (items.length - 1) : 0;
  const totalItemSize = items.reduce(
    (sum, item) => sum + item.computedMainSize,
    0,
  );

  let contentSpace: number;
  if (container.mainSize !== undefined) {
    contentSpace = container.mainSize - pad.mainStart - pad.mainEnd;
  } else {
    contentSpace = totalItemSize + totalGap;
  }

  const freeSpace = Math.max(0, contentSpace - totalItemSize - totalGap);
  const gapCount = Math.max(0, items.length - 1);

  let initialOffset = 0;
  let extraPerGap = 0;

  switch (container.justifyContent) {
    case "flex-start":
      break;
    case "flex-end":
      initialOffset = freeSpace;
      break;
    case "center":
      initialOffset = freeSpace / 2;
      break;
    case "space-between":
      if (gapCount > 0) {
        extraPerGap = freeSpace / gapCount;
      }
      break;
    case "space-around": {
      const totalSlots = items.length;
      if (totalSlots > 0) {
        const perSlot = freeSpace / totalSlots;
        initialOffset = perSlot / 2;
        if (gapCount > 0) {
          extraPerGap = perSlot;
        }
      }
      break;
    }
    case "space-evenly": {
      const totalSlots = items.length + 1;
      if (totalSlots > 0) {
        const perSlot = freeSpace / totalSlots;
        initialOffset = perSlot;
        if (gapCount > 0) {
          extraPerGap = perSlot;
        }
      }
      break;
    }
  }

  let cursor = pad.mainStart + initialOffset;
  for (let i = 0; i < items.length; i++) {
    items[i].mainPos = cursor;
    cursor += items[i].computedMainSize;
    if (i < items.length - 1) {
      cursor += container.mainGap + extraPerGap;
    }
  }
}

/**
 * Phase 4: Position items on the main axis (per line) and the cross axis
 * (align-items / align-self within the line, lines stacked with crossGap
 * between them). Single line reproduces the old positionCrossAxis exactly.
 */
function positionLines(
  lines: FlexItem[][],
  lineCrossSizes: number[],
  container: FlexContainer,
): void {
  const pad = resolvePadding(container);
  let crossCursor = pad.crossStart;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const lineCrossSize = lineCrossSizes[li];

    positionMainAxis(line, container);

    for (const item of line) {
      const effectiveAlign = item.alignSelf ?? container.alignItems;

      switch (effectiveAlign) {
        case "flex-start":
        case "stretch":
          item.crossPos = crossCursor;
          break;
        case "center":
          item.crossPos =
            crossCursor + (lineCrossSize - item.computedCrossSize) / 2;
          break;
        case "flex-end":
          item.crossPos = crossCursor + lineCrossSize - item.computedCrossSize;
          break;
        default:
          item.crossPos = crossCursor;
      }
    }

    crossCursor += lineCrossSize + container.crossGap;
  }
}

/**
 * Convert abstract main/cross coordinates to x/y.
 */
function toLayoutResults(
  items: FlexItem[],
  direction: "row" | "column",
): LayoutResult[] {
  return items.map((item) => {
    if (direction === "row") {
      return {
        id: item.id,
        x: item.mainPos,
        y: item.crossPos,
        width: item.computedMainSize,
        height: item.computedCrossSize,
      };
    } else {
      return {
        id: item.id,
        x: item.crossPos,
        y: item.mainPos,
        width: item.computedCrossSize,
        height: item.computedMainSize,
      };
    }
  });
}

// ── Intrinsic size computation (recursive) ──────────────────────────────────

/**
 * Compute the intrinsic (shrink-wrap) size of a frame based on its children.
 * Used for fit_content sizing of nested auto-layout frames.
 */
function computeIntrinsicSize(frame: FrameNode): {
  width: number;
  height: number;
} {
  if (!frame.layout?.autoLayout || frame.children.length === 0) {
    return { width: frame.width, height: frame.height };
  }

  const container = buildContainer(frame, {
    fitWidth: true,
    fitHeight: true,
  });
  const pad = resolvePadding(container);

  const visibleChildren = frame.children.filter(
    (c) => c.visible !== false && c.enabled !== false && !c.absolutePosition,
  );
  if (visibleChildren.length === 0) {
    return {
      width: container.padding[3] + container.padding[1],
      height: container.padding[0] + container.padding[2],
    };
  }

  const items = visibleChildren.map((child) => buildFlexItem(child, container));

  // In intrinsic mode items keep their basis (fill_container items get 0)
  for (const item of items) {
    item.computedMainSize = item.flexBasis;
    item.computedCrossSize = item.crossBaseSize;
  }

  const totalGap =
    items.length > 1 ? container.mainGap * (items.length - 1) : 0;

  const totalMainSize =
    items.reduce((s, i) => s + i.computedMainSize, 0) +
    totalGap +
    pad.mainStart +
    pad.mainEnd;

  const maxCross =
    items.length > 0 ? Math.max(...items.map((i) => i.crossBaseSize)) : 0;
  const totalCrossSize = maxCross + pad.crossStart + pad.crossEnd;

  if (container.direction === "row") {
    return { width: totalMainSize, height: totalCrossSize };
  } else {
    return { width: totalCrossSize, height: totalMainSize };
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface LayoutResult {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Initialize layout engine (no-op — pure TS, always ready).
 */
export async function initYoga(): Promise<void> {
  // No-op: pure TypeScript engine requires no initialization
}

/**
 * Check if layout engine is ready (always true).
 */
export function isYogaReady(): boolean {
  return true;
}

/**
 * Re-measure text node heights after layout widths are resolved.
 * When text has fill_container width and fit_content height, the correct
 * wrapped height can only be computed once the layout-assigned width is known.
 */
function remeasureTextHeights(
  items: FlexItem[],
  children: SceneNode[],
  container: FlexContainer,
): void {
  const isHorizontal = container.direction === "row";

  for (let i = 0; i < items.length; i++) {
    const child = children[i];
    if (child.type !== "text") continue;

    const textNode = child as TextNode;
    const textMode = textNode.textWidthMode ?? "auto";
    // Only wrapped text (fixed / fixed-height) needs re-measurement
    if (textMode !== "fixed" && textMode !== "fixed-height") continue;

    const heightMode = child.sizing?.heightMode ?? "fixed";
    if (heightMode !== "fit_content") continue;

    const computedWidth = isHorizontal
      ? items[i].computedMainSize
      : items[i].computedCrossSize;

    // Skip if width hasn't changed from the stored value (already measured correctly)
    if (computedWidth === textNode.width) continue;

    const measuredHeight = measureTextFixedWidthHeight({
      ...textNode,
      width: computedWidth,
    });

    if (isHorizontal) {
      items[i].computedCrossSize = measuredHeight;
      items[i].crossBaseSize = measuredHeight;
    } else {
      items[i].computedMainSize = measuredHeight;
    }
  }
}

/**
 * Calculate layout for a Frame and its children.
 * Returns updated positions for all visible children.
 */
export function calculateFrameLayout(frame: FrameNode): LayoutResult[] {
  if (!frame.layout?.autoLayout) {
    return [];
  }

  const fitWidth = frame.sizing?.widthMode === "fit_content";
  const fitHeight = frame.sizing?.heightMode === "fit_content";

  const container = buildContainer(frame, { fitWidth, fitHeight });
  const children = Array.isArray(frame.children) ? frame.children : [];
  const visibleChildren = children.filter(
    (c) => c.visible !== false && c.enabled !== false && !c.absolutePosition,
  );

  if (visibleChildren.length === 0) {
    return [];
  }

  const items = visibleChildren.map((child) => buildFlexItem(child, container));

  const lines = layoutLines(items, container);
  for (const line of lines) resolveMainAxisSizes(line, container);

  const lineCrossSizes = resolveLineCrossSizes(lines, container);
  assignLineCrossSizes(lines, lineCrossSizes, container);

  // Second pass: re-measure text heights using layout-computed widths.
  // Text wrapping depends on the final width, which is only known after
  // main/cross sizing resolves fill_container widths.
  remeasureTextHeights(items, visibleChildren, container);

  positionLines(lines, lineCrossSizes, container);

  return toLayoutResults(items, container.direction);
}

/**
 * Calculate the intrinsic size of a Frame based on its children.
 * Used when sizing.widthMode or sizing.heightMode === 'fit_content'.
 */
export function calculateFrameIntrinsicSize(
  frame: FrameNode,
  options: { fitWidth?: boolean; fitHeight?: boolean } = {},
): { width: number; height: number } {
  if (!frame.layout?.autoLayout) {
    return { width: frame.width, height: frame.height };
  }

  const { fitWidth = false, fitHeight = false } = options;

  if (!fitWidth && !fitHeight) {
    return { width: frame.width, height: frame.height };
  }

  const container = buildContainer(frame, { fitWidth, fitHeight });
  const pad = resolvePadding(container);
  const children = Array.isArray(frame.children) ? frame.children : [];
  const visibleChildren = children.filter(
    (c) => c.visible !== false && c.enabled !== false && !c.absolutePosition,
  );

  if (visibleChildren.length === 0) {
    const pw = container.padding[3] + container.padding[1];
    const ph = container.padding[0] + container.padding[2];
    return {
      width: fitWidth ? pw : frame.width,
      height: fitHeight ? ph : frame.height,
    };
  }

  const items = visibleChildren.map((child) => buildFlexItem(child, container));

  // Run sizing phases to get accurate sizes
  const lines = layoutLines(items, container);
  for (const line of lines) resolveMainAxisSizes(line, container);
  const lineCrossSizes = resolveLineCrossSizes(lines, container);
  assignLineCrossSizes(lines, lineCrossSizes, container);
  remeasureTextHeights(items, visibleChildren, container);

  const totalGap =
    items.length > 1 ? container.mainGap * (items.length - 1) : 0;

  const intrinsicMain =
    items.reduce((s, i) => s + i.computedMainSize, 0) +
    totalGap +
    pad.mainStart +
    pad.mainEnd;

  // Wrapped multi-line: the cross size hugs the summed line sizes (+ gaps
  // between lines) instead of a single line's max. Single line: identical to
  // the pre-wrap `Math.max(...computedCrossSize)` result.
  const totalCrossGap =
    lineCrossSizes.length > 1
      ? container.crossGap * (lineCrossSizes.length - 1)
      : 0;
  const intrinsicCross =
    lineCrossSizes.reduce((s, c) => s + c, 0) +
    totalCrossGap +
    pad.crossStart +
    pad.crossEnd;

  const isHorizontal = container.direction === "row";

  return {
    width: fitWidth
      ? isHorizontal
        ? intrinsicMain
        : intrinsicCross
      : frame.width,
    height: fitHeight
      ? isHorizontal
        ? intrinsicCross
        : intrinsicMain
      : frame.height,
  };
}

/**
 * Calculate the intrinsic height of a Frame based on its children.
 * Used when sizing.heightMode === 'fit_content'.
 */
export function calculateFrameIntrinsicHeight(frame: FrameNode): number {
  return calculateFrameIntrinsicSize(frame, { fitHeight: true }).height;
}

/**
 * Apply layout results to scene nodes.
 * Returns a new array with updated positions and sizes based on sizing mode.
 */
export function applyLayoutToChildren(
  children: SceneNode[],
  layoutResults: LayoutResult[],
): SceneNode[] {
  const resultMap = new Map(layoutResults.map((r) => [r.id, r]));

  return children.map((child) => {
    const result = resultMap.get(child.id);
    if (result) {
      const widthMode = child.sizing?.widthMode ?? "fixed";
      const heightMode = child.sizing?.heightMode ?? "fixed";

      // Min/max clamps apply regardless of sizing mode — a "fixed" child
      // with minWidth/maxWidth still needs its clamped (computed) width, not
      // its raw stored width.
      const widthClamped =
        child.sizing?.minWidth !== undefined ||
        child.sizing?.maxWidth !== undefined;
      const heightClamped =
        child.sizing?.minHeight !== undefined ||
        child.sizing?.maxHeight !== undefined;

      const newWidth =
        widthMode !== "fixed" || widthClamped ? result.width : child.width;
      const newHeight =
        heightMode !== "fixed" || heightClamped ? result.height : child.height;

      return {
        ...child,
        x: result.x,
        y: result.y,
        width: newWidth,
        height: newHeight,
      };
    }
    return child;
  });
}
