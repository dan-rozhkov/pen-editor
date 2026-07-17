export interface RasterCacheInput {
  topLevelFrameIds: string[];
  frameSubtreeDirtyAt: Map<string, number>; // last time (ms clock passed in) any subtree id was dirty
  cachedFrames: Map<string, { resolutionBucket: number }>;
  hotFrameIds: Set<string>; // selection/drag/text-edit inside — never cacheable
  // RAW stored (local-unit) frame size — NOT premultiplied by `scale`.
  // `cacheAsTexture`'s `resolution` multiplies the container's own local
  // bounds, so the texture-size gate below must multiply raw size by the
  // resolution bucket directly; multiplying by `scale` first (the historical
  // behavior) double-applied the zoom factor and was over-conservative.
  framePixelSize: Map<string, { width: number; height: number }>;
  scale: number;
  // devicePixelRatio at render time. Bug 2 (field report): the resolution
  // bucket must derive from EFFECTIVE scale (CSS scale * pixelRatio), not
  // CSS scale alone, or a HiDPI display under-resolves a cached texture and
  // zooming within the same CSS-scale bucket never fixes it. Optional,
  // defaults to 1 for callers that don't care (no dpr scaling).
  pixelRatio?: number;
  now: number;
}

export interface RasterCacheDecisions {
  toCache: Array<{ id: string; resolutionBucket: number }>;
  toUncache: string[];
}

export const QUIET_MS = 500;
export const MAX_TEXTURE_PX = 4096;

export function resolutionBucketFor(scale: number): number {
  if (scale <= 0.5) return 0.5;
  if (scale <= 1) return 1;
  if (scale <= 2) return 2;
  return 4;
}

export function computeRasterCacheDecisions(input: RasterCacheInput): RasterCacheDecisions {
  const pixelRatio = input.pixelRatio ?? 1;
  const bucket = resolutionBucketFor(input.scale * pixelRatio);
  const toCache: RasterCacheDecisions["toCache"] = [];
  const toUncache: string[] = [];
  for (const id of input.topLevelFrameIds) {
    const cached = input.cachedFrames.get(id);
    const dirtyAt = input.frameSubtreeDirtyAt.get(id) ?? 0;
    const quiet = input.now - dirtyAt >= QUIET_MS;
    const hot = input.hotFrameIds.has(id);
    const size = input.framePixelSize.get(id);
    // `size` carries RAW local-unit frame size — actual cached texture
    // pixels are raw size × resolution bucket (see RasterCacheInput doc).
    const fits = !!size && size.width * bucket <= MAX_TEXTURE_PX && size.height * bucket <= MAX_TEXTURE_PX;
    if (cached && (!quiet || hot || cached.resolutionBucket !== bucket || !fits)) {
      toUncache.push(id);
      continue;
    }
    if (!cached && quiet && !hot && fits) toCache.push({ id, resolutionBucket: bucket });
  }
  return { toCache, toUncache };
}
