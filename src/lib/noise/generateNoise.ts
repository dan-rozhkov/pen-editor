import type { NoiseEffect } from "@/types/scene";

/** Max samples per axis — caps texture memory for huge nodes / tiny cells. */
const MAX_CELLS = 2048;

/** Deterministic 32-bit FNV-1a hash of a string (noise pattern seed source). */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Stateless per-cell hash → [0, 1). Deterministic across runs/frames. */
function cellRand(x: number, y: number, seed: number): number {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function parseHex8(color: string): [number, number, number, number] {
  const r = parseInt(color.slice(1, 3), 16) || 0;
  const g = parseInt(color.slice(3, 5), 16) || 0;
  const b = parseInt(color.slice(5, 7), 16) || 0;
  const a = color.length >= 9 ? parseInt(color.slice(7, 9), 16) : 255;
  return [r, g, b, Number.isNaN(a) ? 255 : a];
}

/** Cell-grid dimensions for a node of the given size (>= 1, capped). */
export function noiseCellCounts(effect: NoiseEffect, width: number, height: number): { cellsX: number; cellsY: number } {
  const sx = Math.max(effect.noiseSize, 0.01);
  const sy = Math.max(effect.noiseSizeY ?? effect.noiseSize, 0.01);
  return {
    cellsX: Math.min(MAX_CELLS, Math.max(1, Math.ceil(width / sx))),
    cellsY: Math.min(MAX_CELLS, Math.max(1, Math.ceil(height / sy))),
  };
}

/**
 * One RGBA sample per noise cell (blown up to node size by a nearest-neighbor
 * sprite). Hash-based white noise: cellRand < density → painted, colored by
 * the mono/duo/multi rule; else transparent.
 */
export function generateNoisePixels(effect: NoiseEffect, cellsX: number, cellsY: number, seed: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(cellsX * cellsY * 4);
  const base = parseHex8(effect.color);
  const secondary = parseHex8(effect.secondaryColor ?? "#ffffffff");
  const multiAlpha = Math.round(Math.min(1, Math.max(0, effect.opacity ?? 1)) * 255);
  const density = Math.min(1, Math.max(0, effect.density));
  for (let y = 0; y < cellsY; y++) {
    for (let x = 0; x < cellsX; x++) {
      if (cellRand(x, y, seed) >= density) continue;
      const i = (y * cellsX + x) * 4;
      if (effect.noiseType === "multi") {
        out[i] = Math.floor(cellRand(x, y, seed ^ 0x1234567) * 256);
        out[i + 1] = Math.floor(cellRand(x, y, seed ^ 0x89abcdef) * 256);
        out[i + 2] = Math.floor(cellRand(x, y, seed ^ 0x5f356495) * 256);
        out[i + 3] = multiAlpha;
      } else {
        const c = effect.noiseType === "duo" && cellRand(x, y, seed ^ 0x9e3779b9) < 0.5 ? secondary : base;
        out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = c[3];
      }
    }
  }
  return out;
}
