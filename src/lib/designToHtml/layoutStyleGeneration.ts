import type { FlatFrameNode, FlatSceneNode, LayoutProperties, SizingProperties } from "@/types/scene";

/** The `flex` shorthand emitted for a `fill_container` flex child (grow/shrink, zero basis). Shared with `codegen/tailwind.ts`'s `flex-1` mapping so the two stay in sync. */
export const FLEX_FILL = "1 1 0%";

/**
 * Generate CSS for layout properties (flexbox, sizing, positioning)
 */
export function generateLayoutStyles(
  node: FlatSceneNode,
  parentLayout: LayoutProperties | undefined,
  isRoot: boolean,
): Record<string, string> {
  const styles: Record<string, string> = {};

  // Design tool treats dimensions as including padding/border (border-box)
  styles["box-sizing"] = "border-box";

  // Container layout (frames with auto-layout)
  if (node.type === "frame") {
    const frame = node as FlatFrameNode;
    if (frame.layout?.autoLayout) {
      styles.display = "flex";
      styles["flex-direction"] = frame.layout.flexDirection ?? "column";
      if (frame.layout.flexWrap) {
        styles["flex-wrap"] = "wrap";
      }
      if (frame.layout.rowGap !== undefined || frame.layout.columnGap !== undefined) {
        const rowGap = frame.layout.rowGap ?? frame.layout.gap ?? 0;
        const columnGap = frame.layout.columnGap ?? frame.layout.gap ?? 0;
        if (rowGap > 0) styles["row-gap"] = `${rowGap}px`;
        if (columnGap > 0) styles["column-gap"] = `${columnGap}px`;
      } else if (frame.layout.gap !== undefined && frame.layout.gap > 0) {
        styles.gap = `${frame.layout.gap}px`;
      }
      if (frame.layout.alignItems) {
        styles["align-items"] = frame.layout.alignItems;
      }
      if (frame.layout.justifyContent) {
        styles["justify-content"] = frame.layout.justifyContent;
      }
      const padding = generatePaddingCss(frame.layout);
      if (padding) {
        styles.padding = padding;
      }
    } else {
      // Non-auto-layout frame: children use absolute positioning
      styles.position = "relative";
    }

    // Clip
    if (frame.clip) {
      styles.overflow = "hidden";
    }
  }

  // Sizing within parent context
  if (parentLayout?.autoLayout && !isRoot) {
    Object.assign(styles, generateFlexChildStyles(node.sizing, parentLayout));
  }

  // Fixed sizing for root or non-auto-layout children
  if (isRoot || !parentLayout?.autoLayout) {
    if (node.sizing?.widthMode !== "fill_container" && node.sizing?.widthMode !== "fit_content") {
      styles.width = `${node.width}px`;
    }
    if (node.sizing?.heightMode !== "fill_container" && node.sizing?.heightMode !== "fit_content") {
      styles.height = `${node.height}px`;
    }
  } else {
    // In auto-layout, fixed-sized children still need explicit dimensions
    if (!node.sizing?.widthMode || node.sizing.widthMode === "fixed") {
      styles.width = `${node.width}px`;
    }
    if (!node.sizing?.heightMode || node.sizing.heightMode === "fixed") {
      styles.height = `${node.height}px`;
    }
  }

  // Absolute positioning for children of non-auto-layout frames
  // or for absolutePosition children within auto-layout
  if (!isRoot && node.absolutePosition) {
    styles.position = "absolute";
    styles.left = `${node.x}px`;
    styles.top = `${node.y}px`;
  } else if (!isRoot && !parentLayout?.autoLayout) {
    styles.position = "absolute";
    styles.left = `${node.x}px`;
    styles.top = `${node.y}px`;
  }

  return styles;
}

function generateFlexChildStyles(
  sizing: SizingProperties | undefined,
  parentLayout: LayoutProperties,
): Record<string, string> {
  const styles: Record<string, string> = {};
  const isRow = parentLayout.flexDirection === "row";

  const widthMode = sizing?.widthMode ?? "fixed";
  const heightMode = sizing?.heightMode ?? "fixed";

  // Main axis sizing
  if (isRow) {
    if (widthMode === "fill_container") {
      styles.flex = FLEX_FILL;
      styles["min-width"] = "0";
    } else if (widthMode === "fit_content") {
      styles.flex = "0 0 auto";
    } else {
      // Fixed: prevent flex-shrink from compressing below specified size
      styles["flex-shrink"] = "0";
    }
  } else {
    if (heightMode === "fill_container") {
      styles.flex = FLEX_FILL;
      styles["min-height"] = "0";
    } else if (heightMode === "fit_content") {
      styles.flex = "0 0 auto";
    } else {
      styles["flex-shrink"] = "0";
    }
  }

  // Min/max clamps apply regardless of sizing mode; an explicit minWidth
  // overrides the `min-width: 0` flex-shrink reset above.
  if (sizing?.minWidth !== undefined) styles["min-width"] = `${sizing.minWidth}px`;
  if (sizing?.maxWidth !== undefined) styles["max-width"] = `${sizing.maxWidth}px`;
  if (sizing?.minHeight !== undefined) styles["min-height"] = `${sizing.minHeight}px`;
  if (sizing?.maxHeight !== undefined) styles["max-height"] = `${sizing.maxHeight}px`;

  // Cross axis sizing
  if (isRow) {
    if (heightMode === "fill_container") {
      styles["align-self"] = "stretch";
    } else if (heightMode === "fit_content") {
      styles.height = "fit-content";
    }
  } else {
    if (widthMode === "fill_container") {
      styles["align-self"] = "stretch";
    } else if (widthMode === "fit_content") {
      styles.width = "fit-content";
    }
  }

  return styles;
}

function generatePaddingCss(layout: LayoutProperties): string | null {
  const t = layout.paddingTop ?? 0;
  const r = layout.paddingRight ?? 0;
  const b = layout.paddingBottom ?? 0;
  const l = layout.paddingLeft ?? 0;

  if (t === 0 && r === 0 && b === 0 && l === 0) return null;

  // Use shorthand when possible
  if (t === r && r === b && b === l) return `${t}px`;
  if (t === b && r === l) return `${t}px ${r}px`;
  return `${t}px ${r}px ${b}px ${l}px`;
}
