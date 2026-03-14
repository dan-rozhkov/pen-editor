import type { Graphics } from "pixi.js";
import type { LayoutGridConfig } from "@/types/scene";
import { parseColor } from "./colorHelpers";

const MAX_GRID_STRIPS = 1000;

function drawGridType(
  gfx: Graphics,
  grid: LayoutGridConfig,
  frameWidth: number,
  frameHeight: number,
): void {
  const size = grid.size ?? 10;
  const color = parseColor(grid.color);
  const alpha = grid.opacity;

  if (size <= 0) return;

  const cols = Math.min(Math.ceil(frameWidth / size), MAX_GRID_STRIPS);
  const rows = Math.min(Math.ceil(frameHeight / size), MAX_GRID_STRIPS);

  // Draw horizontal strips on even rows, offset by one cell on odd rows
  for (let row = 0; row < rows; row++) {
    const y = row * size;
    const h = Math.min(size, frameHeight - y);
    const startCol = row % 2 === 0 ? 0 : 1;
    for (let col = startCol; col < cols; col += 2) {
      const x = col * size;
      const w = Math.min(size, frameWidth - x);
      gfx.rect(x, y, w, h).fill({ color, alpha });
    }
  }
}

function drawColumnsOrRows(
  gfx: Graphics,
  grid: LayoutGridConfig,
  frameWidth: number,
  frameHeight: number,
): void {
  const isColumns = grid.type === "columns";
  const count = Math.min(grid.count ?? 5, MAX_GRID_STRIPS);
  const gutter = grid.gutter ?? 20;
  const margin = grid.margin ?? 0;
  const alignment = grid.alignment ?? "stretch";
  const color = parseColor(grid.color);
  const alpha = grid.opacity;

  if (count <= 0) return;

  const totalLength = isColumns ? frameWidth : frameHeight;
  const crossLength = isColumns ? frameHeight : frameWidth;

  let itemWidth: number;
  let startOffset: number;

  if (alignment === "stretch" || grid.width == null) {
    // Stretch: fill available space between margins
    const available = totalLength - 2 * margin;
    itemWidth = (available - (count - 1) * gutter) / count;
    startOffset = margin;
  } else {
    // Explicit width per item
    itemWidth = grid.width;
    const totalItemsWidth = count * itemWidth + (count - 1) * gutter;

    switch (alignment) {
      case "min":
        startOffset = margin;
        break;
      case "max":
        startOffset = totalLength - margin - totalItemsWidth;
        break;
      case "center":
        startOffset = (totalLength - totalItemsWidth) / 2;
        break;
      default:
        startOffset = margin;
    }
  }

  for (let i = 0; i < count; i++) {
    const pos = startOffset + i * (itemWidth + gutter);
    if (isColumns) {
      gfx.rect(pos, 0, itemWidth, crossLength).fill({ color, alpha });
    } else {
      gfx.rect(0, pos, crossLength, itemWidth).fill({ color, alpha });
    }
  }
}

/**
 * Draw all layout grids for a frame onto a Graphics object.
 */
export function drawLayoutGrids(
  gfx: Graphics,
  grids: LayoutGridConfig[],
  frameWidth: number,
  frameHeight: number,
): void {
  for (const grid of grids) {
    if (!grid.visible) continue;

    switch (grid.type) {
      case "grid":
        drawGridType(gfx, grid, frameWidth, frameHeight);
        break;
      case "columns":
      case "rows":
        drawColumnsOrRows(gfx, grid, frameWidth, frameHeight);
        break;
    }
  }
}
