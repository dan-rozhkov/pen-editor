/**
 * Pure TypeScript flexbox layout engine.
 * Replaces yoga-layout (WASM) with a zero-dependency implementation
 * supporting: direction, gap, padding, align-items, justify-content,
 * flex-grow/shrink, and sizing modes (fixed, fill_container, fit_content).
 */

import type {
  SceneNode,
  FrameNode,
  AlignItems,
  JustifyContent,
} from "../types/scene";

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
  gap: number;
  padding: [number, number, number, number]; // [top, right, bottom, left]
  alignItems: AlignItems;
  justifyContent: JustifyContent;
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
    gap: layout?.gap ?? 0,
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
  }

  return { width: effectiveWidth, height: effectiveHeight };
}

function buildFlexItem(child: SceneNode, container: FlexContainer): FlexItem {
  const isHorizontal = container.direction === "row";

  const widthMode: SizingMode = child.sizing?.widthMode ?? "fixed";
  const heightMode: SizingMode = child.sizing?.heightMode ?? "fixed";

  const mainSizeMode = isHorizontal ? widthMode : heightMode;
  const crossSizeMode = isHorizontal ? heightMode : widthMode;

  const { width: effectiveWidth, height: effectiveHeight } =
    resolveEffectiveSize(child, widthMode, heightMode);

  const mainBaseSize = isHorizontal ? effectiveWidth : effectiveHeight;
  const crossBaseSize = isHorizontal ? effectiveHeight : effectiveWidth;

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
  const totalGap = items.length > 1 ? container.gap * (items.length - 1) : 0;

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
}

/**
 * Phase 2: Resolve cross-axis sizes (stretch vs base size).
 */
function resolveCrossAxisSizes(
  items: FlexItem[],
  container: FlexContainer,
): void {
  const pad = resolvePadding(container);

  if (container.crossSize !== undefined) {
    const contentCrossSpace =
      container.crossSize - pad.crossStart - pad.crossEnd;

    for (const item of items) {
      const effectiveAlign = item.alignSelf ?? container.alignItems;
      if (effectiveAlign === "stretch") {
        item.computedCrossSize = contentCrossSpace;
      } else {
        item.computedCrossSize = item.crossBaseSize;
      }
    }
  } else {
    // Intrinsic mode: no stretching
    for (const item of items) {
      item.computedCrossSize = item.crossBaseSize;
    }
  }
}

/**
 * Phase 3: Position items on the main axis (justify-content).
 */
function positionMainAxis(items: FlexItem[], container: FlexContainer): void {
  if (items.length === 0) return;

  const pad = resolvePadding(container);
  const totalGap = items.length > 1 ? container.gap * (items.length - 1) : 0;
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
      cursor += container.gap + extraPerGap;
    }
  }
}

/**
 * Phase 4: Position items on the cross axis (align-items / align-self).
 */
function positionCrossAxis(items: FlexItem[], container: FlexContainer): void {
  const pad = resolvePadding(container);

  let contentCrossSpace: number;
  if (container.crossSize !== undefined) {
    contentCrossSpace = container.crossSize - pad.crossStart - pad.crossEnd;
  } else {
    contentCrossSpace =
      items.length > 0 ? Math.max(...items.map((i) => i.computedCrossSize)) : 0;
  }

  for (const item of items) {
    const effectiveAlign = item.alignSelf ?? container.alignItems;

    switch (effectiveAlign) {
      case "flex-start":
      case "stretch":
        item.crossPos = pad.crossStart;
        break;
      case "center":
        item.crossPos =
          pad.crossStart + (contentCrossSpace - item.computedCrossSize) / 2;
        break;
      case "flex-end":
        item.crossPos =
          pad.crossStart + contentCrossSpace - item.computedCrossSize;
        break;
      default:
        item.crossPos = pad.crossStart;
    }
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

  const visibleChildren = frame.children.filter((c) => c.visible !== false);
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

  const totalGap = items.length > 1 ? container.gap * (items.length - 1) : 0;

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
  const visibleChildren = frame.children.filter((c) => c.visible !== false);

  if (visibleChildren.length === 0) {
    return [];
  }

  const items = visibleChildren.map((child) => buildFlexItem(child, container));

  resolveMainAxisSizes(items, container);
  resolveCrossAxisSizes(items, container);
  positionMainAxis(items, container);
  positionCrossAxis(items, container);

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
  const visibleChildren = frame.children.filter((c) => c.visible !== false);

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
  resolveMainAxisSizes(items, container);
  resolveCrossAxisSizes(items, container);

  const totalGap = items.length > 1 ? container.gap * (items.length - 1) : 0;

  const intrinsicMain =
    items.reduce((s, i) => s + i.computedMainSize, 0) +
    totalGap +
    pad.mainStart +
    pad.mainEnd;

  const intrinsicCross =
    (items.length > 0
      ? Math.max(...items.map((i) => i.computedCrossSize))
      : 0) +
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

      const newWidth = widthMode !== "fixed" ? result.width : child.width;
      const newHeight = heightMode !== "fixed" ? result.height : child.height;

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
