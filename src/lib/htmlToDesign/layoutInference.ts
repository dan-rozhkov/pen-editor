import type {
  SceneNode,
  FrameNode,
  LayoutProperties,
  FlexDirection,
  AlignItems,
  JustifyContent,
  SizingMode,
} from "@/types/scene";
import { generateId } from "@/types/scene";
import { hasPadding, hasVisualStyling, parsePadding } from "./elementChecks";
import { measureNodeContents } from "./textMeasurement";

const CSS_ALIGN_ITEMS_MAP: Record<string, AlignItems> = {
  "flex-start": "flex-start",
  "start": "flex-start",
  "flex-end": "flex-end",
  "end": "flex-end",
  "center": "center",
  "stretch": "stretch",
};

const CSS_JUSTIFY_CONTENT_MAP: Record<string, JustifyContent> = {
  "flex-start": "flex-start",
  "start": "flex-start",
  "flex-end": "flex-end",
  "end": "flex-end",
  "center": "center",
  "space-between": "space-between",
  "space-around": "space-around",
  "space-evenly": "space-evenly",
};

/** Pixel tolerance for visual row/column alignment detection */
const ALIGNMENT_TOLERANCE = 6;

/** Infer auto-layout properties from CSS display/flex */
export interface AutoLayoutResult {
  layout: LayoutProperties;
  /** For CSS grids with multiple columns, includes metadata for row grouping */
  grid?: {
    colCount: number;
    columnGap: number;
    rowGap: number;
    alignItems?: AlignItems;
  };
}

/**
 * Compute the gap between consecutive visible, non-absolute children by
 * measuring the space between their bounding rects. Returns the median of
 * positive gaps (robust against outliers), rounded to the nearest integer.
 */
export function computeGapFromChildRects(el: Element, direction: FlexDirection): number {
  const rects = getFlowChildRects(el);

  if (rects.length < 2) return 0;

  const gaps: number[] = [];
  for (let i = 1; i < rects.length; i++) {
    const prev = rects[i - 1];
    const curr = rects[i];
    const gap = direction === "column"
      ? curr.top - prev.bottom
      : curr.left - prev.right;
    if (gap !== 0) gaps.push(gap);
  }

  if (gaps.length === 0) return 0;

  // Median
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 === 0
    ? (gaps[mid - 1] + gaps[mid]) / 2
    : gaps[mid];

  return Math.round(median);
}

function getFlowChildRects(el: Element): DOMRect[] {
  const rects: DOMRect[] = [];

  for (const child of el.childNodes) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const childEl = child as Element;
      const childStyle = window.getComputedStyle(childEl);
      if (childStyle.display === "none" || childStyle.visibility === "hidden") continue;
      if (childStyle.position === "absolute" || childStyle.position === "fixed") continue;

      const rect = childEl.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) {
        rects.push(rect);
      }
      continue;
    }

    if (child.nodeType !== Node.TEXT_NODE || !child.textContent?.trim()) {
      continue;
    }

    const measurement = measureNodeContents(child);
    if (measurement) {
      rects.push(measurement.bounds);
    }
  }

  return rects;
}

export function inferAutoLayout(
  style: CSSStyleDeclaration,
  el?: Element,
): AutoLayoutResult | undefined {
  const display = style.display;

  if (display === "flex" || display === "inline-flex") {
    const flexDirection =
      style.flexDirection === "row" || style.flexDirection === "row-reverse"
        ? "row"
        : "column";

    let mainAxisGap =
      flexDirection === "row"
        ? parseFloat(style.columnGap) || parseFloat(style.gap) || 0
        : parseFloat(style.rowGap) || parseFloat(style.gap) || 0;

    // If CSS gap is 0 but children have margin-based spacing, infer from rects
    if (mainAxisGap === 0 && el) {
      mainAxisGap = computeGapFromChildRects(el, flexDirection as FlexDirection);
    }

    const layout: LayoutProperties = {
      autoLayout: true,
      flexDirection: flexDirection as FlexDirection,
      gap: mainAxisGap,
      ...parsePadding(style),
    };

    // Align items
    const alignItems = style.alignItems;
    if (alignItems && CSS_ALIGN_ITEMS_MAP[alignItems]) {
      layout.alignItems = CSS_ALIGN_ITEMS_MAP[alignItems];
    }

    // Justify content
    const justifyContent = style.justifyContent;
    if (justifyContent && CSS_JUSTIFY_CONTENT_MAP[justifyContent]) {
      layout.justifyContent = CSS_JUSTIFY_CONTENT_MAP[justifyContent];
    }

    return { layout };
  }

  // CSS Grid → infer direction from columns
  if (display === "grid" || display === "inline-grid") {
    const cols = style.gridTemplateColumns;
    // Count columns: if >1 resolved column track, treat as row layout
    const colCount = cols ? cols.trim().split(/\s+/).length : 1;

    const fallbackGap = parseFloat(style.gap) || 0;
    const columnGap = parseFloat(style.columnGap) || fallbackGap;
    const rowGap = parseFloat(style.rowGap) || fallbackGap;

    const mappedAlignItems = CSS_ALIGN_ITEMS_MAP[style.alignItems];

    if (colCount > 1) {
      // Multi-column grid: parent becomes a column layout with rowGap.
      // Children will be grouped into row frames by convertElement().
      const layout: LayoutProperties = {
        autoLayout: true,
        flexDirection: "column",
        gap: rowGap,
        ...parsePadding(style),
      };

      return {
        layout,
        grid: {
          colCount,
          columnGap,
          rowGap,
          alignItems: mappedAlignItems ?? "stretch",
        },
      };
    }

    // Single-column grid: treat as column layout
    let gap = rowGap;
    if (gap === 0 && el) {
      gap = computeGapFromChildRects(el, "column");
    }

    const layout: LayoutProperties = {
      autoLayout: true,
      flexDirection: "column",
      gap,
      ...parsePadding(style),
    };

    if (mappedAlignItems) {
      layout.alignItems = mappedAlignItems;
    }

    // Map justify-content (main-axis alignment)
    const gridJustifyContent = style.justifyContent;
    if (gridJustifyContent && CSS_JUSTIFY_CONTENT_MAP[gridJustifyContent]) {
      layout.justifyContent = CSS_JUSTIFY_CONTENT_MAP[gridJustifyContent];
    }

    return { layout };
  }

  const singleChildLayout = inferSingleChildLayout(style, el);
  if (singleChildLayout) {
    return { layout: singleChildLayout };
  }

  const flowLayout = inferFlowLayout(style, el, display);
  return flowLayout ? { layout: flowLayout } : undefined;
}

function inferSingleChildLayout(
  style: CSSStyleDeclaration,
  el: Element | undefined,
): LayoutProperties | undefined {
  if (!el) return undefined;

  const childRects = getFlowChildRects(el);
  if (childRects.length !== 1) return undefined;

  const shouldPreserveAsBox =
    el.tagName.toLowerCase() === "button" ||
    hasPadding(style) ||
    hasVisualStyling(style);
  if (!shouldPreserveAsBox) return undefined;

  const padding = parsePadding(style);
  const parentRect = el.getBoundingClientRect();
  const childRect = childRects[0];

  const contentLeft = parentRect.left + padding.paddingLeft;
  const contentTop = parentRect.top + padding.paddingTop;
  const contentWidth = Math.max(parentRect.width - padding.paddingLeft - padding.paddingRight, 0);
  const contentHeight = Math.max(parentRect.height - padding.paddingTop - padding.paddingBottom, 0);

  const layout: LayoutProperties = {
    autoLayout: true,
    flexDirection: "row",
    gap: 0,
    ...padding,
  };

  const childCenterY = childRect.top + childRect.height / 2;
  const contentCenterY = contentTop + contentHeight / 2;
  if (contentHeight > 0 && Math.abs(childCenterY - contentCenterY) <= ALIGNMENT_TOLERANCE) {
    layout.alignItems = "center";
  }

  const childCenterX = childRect.left + childRect.width / 2;
  const contentCenterX = contentLeft + contentWidth / 2;
  if (
    contentWidth > 0 &&
    (style.textAlign === "center" || Math.abs(childCenterX - contentCenterX) <= ALIGNMENT_TOLERANCE)
  ) {
    layout.justifyContent = "center";
  }

  return layout;
}

/**
 * Infer flow layout for non-flex/grid containers using actual child geometry.
 * Returns row/column only when children are clearly aligned on one axis.
 */
function inferFlowLayout(
  style: CSSStyleDeclaration,
  el: Element | undefined,
  display: string,
): LayoutProperties | undefined {
  if (!el) return undefined;
  if (display === "none" || display === "contents") return undefined;

  const candidates = getFlowChildRects(el);

  if (candidates.length < 2) return undefined;

  const first = candidates[0];
  const firstCenterY = first.top + first.height / 2;
  const firstLeft = first.left;
  const rowAligned = candidates.every((rect) => {
    const centerY = rect.top + rect.height / 2;
    return Math.abs(centerY - firstCenterY) <= ALIGNMENT_TOLERANCE;
  });
  const columnAligned = candidates.every((rect) => Math.abs(rect.left - firstLeft) <= ALIGNMENT_TOLERANCE);

  const monotonicX = candidates.every((rect, i) => i === 0 || rect.left >= candidates[i - 1].left - ALIGNMENT_TOLERANCE);
  const monotonicY = candidates.every((rect, i) => i === 0 || rect.top >= candidates[i - 1].top - ALIGNMENT_TOLERANCE);

  let direction: FlexDirection | null = null;
  if (rowAligned && monotonicX) direction = "row";
  else if (columnAligned && monotonicY) direction = "column";

  if (!direction) return undefined;

  return {
    autoLayout: true,
    flexDirection: direction,
    gap: computeGapFromChildRects(el, direction),
    ...parsePadding(style),
  };
}

/**
 * Group a grid frame's children into row frames based on visual rows
 * detected from child bounding rects. Absolute-positioned children are
 * kept at the parent level.
 */
export function groupGridChildrenIntoRows(
  frame: FrameNode,
  el: Element,
  grid: NonNullable<AutoLayoutResult["grid"]>,
  elementNodeMap: Map<Element, SceneNode>,
): void {
  const absChildren: SceneNode[] = [];
  // Pair each flow child with its DOM bounding rect via elementNodeMap
  const flowEntries: { node: SceneNode; rect: DOMRect }[] = [];

  for (const domChild of el.children) {
    const node = elementNodeMap.get(domChild);
    if (!node || node.absolutePosition) {
      if (node?.absolutePosition) absChildren.push(node);
      continue;
    }
    const rect = domChild.getBoundingClientRect();
    flowEntries.push({ node, rect });
  }
  // Include flow children not found via elementNodeMap (e.g. text nodes)
  const mappedNodes = new Set(flowEntries.map((e) => e.node));
  for (const child of frame.children) {
    if (child.absolutePosition) {
      if (!absChildren.includes(child)) absChildren.push(child);
      continue;
    }
    if (!mappedNodes.has(child)) {
      flowEntries.push({ node: child, rect: new DOMRect(0, 0, 0, 0) });
    }
  }

  if (flowEntries.length === 0) return;

  // Group flow children by their visual row (top coordinate)
  const rows: { node: SceneNode; rect: DOMRect }[][] = [];
  let currentRow: { node: SceneNode; rect: DOMRect }[] = [];
  let currentRowTop: number | null = null;

  for (const entry of flowEntries) {
    if (currentRowTop === null || Math.abs(entry.rect.top - currentRowTop) > ALIGNMENT_TOLERANCE) {
      if (currentRow.length > 0) rows.push(currentRow);
      currentRow = [entry];
      currentRowTop = entry.rect.top;
    } else {
      currentRow.push(entry);
    }
  }
  if (currentRow.length > 0) rows.push(currentRow);

  const flowChildren = flowEntries.map((e) => e.node);

  // If only one row detected, no need for wrapping — just treat as row layout
  if (rows.length <= 1) {
    frame.layout = {
      ...frame.layout,
      flexDirection: "row",
      gap: grid.columnGap,
      ...(grid.alignItems && { alignItems: grid.alignItems }),
    };
    for (const child of flowChildren) {
      child.x = 0;
      child.y = 0;
      inferChildSizing(child, frame, flowChildren.length);
    }
    return;
  }

  // Create row frames for each visual row
  const contentWidth = frame.width - (frame.layout?.paddingLeft ?? 0) - (frame.layout?.paddingRight ?? 0);
  const rowFrames: FrameNode[] = [];
  for (const rowEntries of rows) {
    const rowChildren = rowEntries.map((e) => e.node);
    const rowFrame: FrameNode = {
      id: generateId(),
      type: "frame",
      name: "row",
      x: 0,
      y: 0,
      width: contentWidth,
      height: 0,
      children: rowChildren,
      layout: {
        autoLayout: true,
        flexDirection: "row",
        gap: grid.columnGap,
        ...(grid.alignItems && { alignItems: grid.alignItems }),
      },
      sizing: { widthMode: "fill_container", heightMode: "fixed" },
    };

    let maxHeight = 0;
    for (const child of rowChildren) {
      child.x = 0;
      child.y = 0;
      if (child.height > maxHeight) maxHeight = child.height;
      inferChildSizing(child, rowFrame, rowChildren.length);
    }
    rowFrame.height = maxHeight;

    rowFrames.push(rowFrame);
  }

  frame.children = [...rowFrames, ...absChildren];
}

/** Infer sizing mode for a child inside an auto-layout parent */
export function inferChildSizing(
  child: SceneNode,
  parentFrame: FrameNode,
  nonAbsCount: number,
): void {
  // Check if child width matches parent content width (fill_container)
  const parentContentWidth =
    parentFrame.width -
    (parentFrame.layout?.paddingLeft ?? 0) -
    (parentFrame.layout?.paddingRight ?? 0);
  const parentContentHeight =
    parentFrame.height -
    (parentFrame.layout?.paddingTop ?? 0) -
    (parentFrame.layout?.paddingBottom ?? 0);

  const widthRatio = child.width / parentContentWidth;
  const heightRatio = child.height / parentContentHeight;

  let widthMode: SizingMode = "fixed";
  let heightMode: SizingMode = "fixed";

  if (parentFrame.layout?.flexDirection === "column") {
    // If child width is ~100% of parent content width, use fill_container
    if (widthRatio > 0.95) {
      widthMode = "fill_container";
    }
  } else if (parentFrame.layout?.flexDirection === "row") {
    // For row layouts, check if children are equal-width (grid-like)
    if (nonAbsCount > 1) {
      const gap = parentFrame.layout?.gap ?? 0;
      const expectedChildWidth = (parentContentWidth - gap * (nonAbsCount - 1)) / nonAbsCount;
      // If this child's width is close to the expected equal share, use fill_container
      if (expectedChildWidth > 0 && Math.abs(child.width - expectedChildWidth) / expectedChildWidth < 0.1) {
        widthMode = "fill_container";
      }
    }
    if (heightRatio > 0.95) {
      heightMode = "fill_container";
    }
  }

  if (widthMode !== "fixed" || heightMode !== "fixed") {
    child.sizing = { widthMode, heightMode };
  }
}
