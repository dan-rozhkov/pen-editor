import type { SceneState } from "@/store/sceneStore";
import { createSpatialGrid, type Rect } from "./spatialGrid";
import { nodeEffectMargin } from "./effectMargin";

/**
 * Grid-backed replacement for the per-frame `computeViewportRenderability`
 * full-tree walk. Maintains absolute (store-coordinate) AABBs in a spatial
 * grid so `queryVisible` is a grid query instead of an O(scene) traversal.
 *
 * Rotation pivot note: renderers apply `container.rotation` with the default
 * pivot (0,0) and `container.position` set to the node's own (x, y) — i.e.
 * rotation happens around the node's *top-left corner* in its local frame,
 * not its center (see `renderers/index.ts` `createNodeContainer`/
 * `updateNodeContainer`: position is set from node.x/y, pivot is only
 * touched by flipX/flipY). This index's rotated-AABB math mirrors that
 * convention rather than the center-pivot assumption in the task brief.
 *
 * Same approximation as the legacy culling: auto-layout container offsets
 * are ignored (absolute rects are accumulated from stored x/y only).
 */
export function createCullingIndex() {
  let grid = createSpatialGrid();
  // ids currently present in the grid (i.e. grid.set has been called for them).
  const indexedIds = new Set<string>();
  // ids whose whole subtree is covered by a single rotated ancestor's AABB —
  // their descendants are intentionally NOT indexed individually.
  const rotatedCovering = new Set<string>();

  let nodesById: SceneState["nodesById"] = {};
  let childrenById: SceneState["childrenById"] = {};
  let parentById: SceneState["parentById"] = {};
  let rootIds: string[] = [];

  /**
   * Union bounding box of `id` and all its descendants, in `id`'s own local
   * (untranslated, unrotated) frame.
   *
   * A descendant with its own non-zero rotation contributes its *rotated*
   * AABB (its own subtree box, recursively computed, then rotated around
   * its local origin) instead of its raw unrotated rect, and recursion
   * stops there — mirrors the top-level rotated-node handling below. Using
   * the raw rect would under-count: a nested-rotated node near the
   * subtree's edge can poke outside the naively-computed box, so the outer
   * covering AABB would wrongly say "off-screen" while the nested node is
   * actually on-screen.
   */
  function collectLocalSubtreeBox(id: string): Rect {
    const rootNode = nodesById[id];
    const rootMargin = rootNode ? nodeEffectMargin(rootNode) : 0;
    const box: Rect = rootNode
      ? { minX: -rootMargin, minY: -rootMargin, maxX: rootNode.width + rootMargin, maxY: rootNode.height + rootMargin }
      : { minX: 0, minY: 0, maxX: 0, maxY: 0 };

    const expand = (r: Rect): void => {
      if (r.minX < box.minX) box.minX = r.minX;
      if (r.minY < box.minY) box.minY = r.minY;
      if (r.maxX > box.maxX) box.maxX = r.maxX;
      if (r.maxY > box.maxY) box.maxY = r.maxY;
    };

    const visit = (curId: string, offsetX: number, offsetY: number): void => {
      for (const childId of childrenById[curId] ?? []) {
        const child = nodesById[childId];
        if (!child) continue;
        const x = offsetX + child.x;
        const y = offsetY + child.y;
        const childRotation = child.rotation ?? 0;
        if (childRotation !== 0) {
          const childLocalBox = collectLocalSubtreeBox(childId);
          expand(rotatedAabb(childLocalBox, childRotation, x, y));
          continue; // covered conservatively — don't also visit its children
        }
        const childMargin = nodeEffectMargin(child);
        expand({
          minX: x - childMargin,
          minY: y - childMargin,
          maxX: x + child.width + childMargin,
          maxY: y + child.height + childMargin,
        });
        visit(childId, x, y);
      }
    };
    visit(id, 0, 0);
    return box;
  }

  /** AABB of `localRect` rotated by `rotationDeg` around local origin (0,0), then translated to (originX, originY). */
  function rotatedAabb(localRect: Rect, rotationDeg: number, originX: number, originY: number): Rect {
    const rad = (rotationDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const corners: Array<[number, number]> = [
      [localRect.minX, localRect.minY],
      [localRect.maxX, localRect.minY],
      [localRect.maxX, localRect.maxY],
      [localRect.minX, localRect.maxY],
    ];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [lx, ly] of corners) {
      const wx = originX + lx * cos - ly * sin;
      const wy = originY + lx * sin + ly * cos;
      if (wx < minX) minX = wx;
      if (wy < minY) minY = wy;
      if (wx > maxX) maxX = wx;
      if (wy > maxY) maxY = wy;
    }
    return { minX, minY, maxX, maxY };
  }

  /**
   * Purges any stale grid entries for `id`'s current descendants (used when
   * a subtree transitions into "covered by rotated ancestor" territory —
   * those descendants must stop being individually indexed).
   */
  function purgeCoveredSubtree(id: string): void {
    for (const childId of childrenById[id] ?? []) {
      if (indexedIds.has(childId)) {
        grid.remove(childId);
        indexedIds.delete(childId);
      }
      rotatedCovering.delete(childId);
      purgeCoveredSubtree(childId);
    }
  }

  /**
   * Re-index `id` and its subtree from scratch, given the accumulated
   * absolute offset of `id`'s parent. Used both for the full rebuild (called
   * per root) and for incremental re-indexing (called at the computed index
   * root for a batch of changed ids). Always walks the whole current subtree
   * — descendant absolute rects depend on every ancestor's x/y, and a single
   * ancestor move shifts them all.
   */
  function reindexSubtree(id: string, offsetX: number, offsetY: number): void {
    const node = nodesById[id];
    if (!node) {
      if (indexedIds.has(id)) {
        grid.remove(id);
        indexedIds.delete(id);
      }
      rotatedCovering.delete(id);
      return;
    }

    const rotation = node.rotation ?? 0;
    if (rotation !== 0) {
      const localBox = collectLocalSubtreeBox(id);
      const originX = offsetX + node.x;
      const originY = offsetY + node.y;
      const rect = rotatedAabb(localBox, rotation, originX, originY);
      grid.set(id, rect);
      indexedIds.add(id);
      rotatedCovering.add(id);
      // Descendants are covered by this AABB, not indexed individually — but
      // still visit them to drop any stale entries from before this node
      // became rotated (e.g. it previously indexed its children directly).
      purgeCoveredSubtree(id);
      return;
    }

    rotatedCovering.delete(id);
    const x = offsetX + node.x;
    const y = offsetY + node.y;
    const margin = nodeEffectMargin(node);
    grid.set(id, { minX: x - margin, minY: y - margin, maxX: x + node.width + margin, maxY: y + node.height + margin });
    indexedIds.add(id);
    for (const childId of childrenById[id] ?? []) {
      reindexSubtree(childId, x, y);
    }
  }

  /** Topmost rotated ancestor of `id` (inclusive), or `id` itself if none. */
  function findIndexRoot(id: string): string {
    const chain: string[] = [];
    let cur: string | null = id;
    while (cur != null) {
      chain.push(cur);
      cur = parentById[cur] ?? null;
    }
    for (let i = chain.length - 1; i >= 0; i--) {
      const n = nodesById[chain[i]];
      if (n && (n.rotation ?? 0) !== 0) return chain[i];
    }
    return id;
  }

  /** Accumulated absolute offset of `id`'s parent chain (all guaranteed unrotated above `id`). */
  function ancestorOffset(id: string): { offsetX: number; offsetY: number } {
    const chain: string[] = [];
    let cur = parentById[id] ?? null;
    while (cur != null) {
      chain.push(cur);
      cur = parentById[cur] ?? null;
    }
    let offsetX = 0, offsetY = 0;
    for (let i = chain.length - 1; i >= 0; i--) {
      const n = nodesById[chain[i]];
      if (n) {
        offsetX += n.x;
        offsetY += n.y;
      }
    }
    return { offsetX, offsetY };
  }

  function addDescendants(id: string, out: Set<string>): void {
    for (const childId of childrenById[id] ?? []) {
      if (out.has(childId)) continue;
      out.add(childId);
      addDescendants(childId, out);
    }
  }

  return {
    rebuild(state: SceneState): void {
      nodesById = state.nodesById;
      childrenById = state.childrenById;
      parentById = state.parentById;
      rootIds = state.rootIds;
      grid = createSpatialGrid();
      indexedIds.clear();
      rotatedCovering.clear();
      for (const rootId of rootIds) reindexSubtree(rootId, 0, 0);
    },

    updateForChanged(state: SceneState, changedIds: Set<string>): void {
      nodesById = state.nodesById;
      childrenById = state.childrenById;
      parentById = state.parentById;
      rootIds = state.rootIds;

      const reindexRoots = new Set<string>();
      for (const id of changedIds) {
        if (!state.nodesById[id]) {
          if (indexedIds.has(id)) {
            grid.remove(id);
            indexedIds.delete(id);
          }
          rotatedCovering.delete(id);
          continue;
        }
        reindexRoots.add(findIndexRoot(id));
      }
      for (const rootId of reindexRoots) {
        const { offsetX, offsetY } = ancestorOffset(rootId);
        reindexSubtree(rootId, offsetX, offsetY);
      }
    },

    queryVisible(bounds: Rect): Set<string> {
      // One Set, filled in place by grid.query's `out` param, instead of
      // allocating a `hits` set and then copying it into a second `visible`
      // set. `hits` is snapshotted as an array before the loops below start
      // mutating `visible` in place, so iteration stays over the original
      // grid hits only (adding ancestors/descendants must not itself expand
      // what these loops walk).
      const visible = new Set<string>();
      grid.query(bounds, visible);
      const hits = [...visible];

      for (const id of hits) {
        let cur = parentById[id] ?? null;
        while (cur != null && !visible.has(cur)) {
          visible.add(cur);
          cur = parentById[cur] ?? null;
        }
      }

      for (const id of hits) {
        if (!rotatedCovering.has(id)) continue;
        addDescendants(id, visible);
      }

      return visible;
    },
  };
}
