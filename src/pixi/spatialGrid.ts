export interface Rect { minX: number; minY: number; maxX: number; maxY: number }

/** Uniform grid over world space. Entries live in every cell their AABB spans. */
export function createSpatialGrid(cellSize = 2048) {
  const cells = new Map<string, Set<string>>();       // "cx,cy" -> ids
  const entryRects = new Map<string, Rect>();
  const entryCells = new Map<string, string[]>();

  const isFiniteRect = (r: Rect): boolean =>
    Number.isFinite(r.minX) && Number.isFinite(r.minY) && Number.isFinite(r.maxX) && Number.isFinite(r.maxY);

  const cellsFor = (r: Rect): string[] => {
    const keys: string[] = [];
    const x0 = Math.floor(r.minX / cellSize), x1 = Math.floor(r.maxX / cellSize);
    const y0 = Math.floor(r.minY / cellSize), y1 = Math.floor(r.maxY / cellSize);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) keys.push(`${cx},${cy}`);
    return keys;
  };

  const detach = (id: string): void => {
    for (const key of entryCells.get(id) ?? []) {
      const cell = cells.get(key);
      cell?.delete(id);
      if (cell && cell.size === 0) cells.delete(key);
    }
    entryCells.delete(id);
    entryRects.delete(id);
  };

  return {
    set(id: string, rect: Rect): void {
      detach(id);
      entryRects.set(id, rect);
      // A non-finite rect (Infinity/NaN bounds) has no well-defined cell span — indexing it would
      // loop forever (Infinity) or produce garbage keys (NaN). Treat it as intersecting nothing:
      // record the rect (so size()/remove() stay consistent) but skip cell indexing entirely.
      if (!isFiniteRect(rect)) {
        entryCells.set(id, []);
        return;
      }
      const keys = cellsFor(rect);
      for (const key of keys) {
        let cell = cells.get(key);
        if (!cell) cells.set(key, (cell = new Set()));
        cell.add(id);
      }
      entryCells.set(id, keys);
    },
    remove: detach,
    query(rect: Rect, out = new Set<string>()): Set<string> {
      if (!isFiniteRect(rect)) return out;
      for (const key of cellsFor(rect)) {
        for (const id of cells.get(key) ?? []) {
          const r = entryRects.get(id)!;
          if (!(r.maxX < rect.minX || r.minX > rect.maxX || r.maxY < rect.minY || r.minY > rect.maxY)) out.add(id);
        }
      }
      return out;
    },
    size: () => entryRects.size,
  };
}
