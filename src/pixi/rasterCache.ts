export interface RasterCacheInput {
  topLevelFrameIds: string[];
  frameSubtreeDirtyAt: Map<string, number>; // last time (ms clock passed in) any subtree id was dirty
  cachedFrames: Map<string, { resolutionBucket: number }>;
  hotFrameIds: Set<string>; // selection/drag/text-edit inside — never cacheable
  framePixelSize: Map<string, { width: number; height: number }>; // at current zoom
  scale: number;
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
  const bucket = resolutionBucketFor(input.scale);
  const toCache: RasterCacheDecisions["toCache"] = [];
  const toUncache: string[] = [];
  for (const id of input.topLevelFrameIds) {
    const cached = input.cachedFrames.get(id);
    const dirtyAt = input.frameSubtreeDirtyAt.get(id) ?? 0;
    const quiet = input.now - dirtyAt >= QUIET_MS;
    const hot = input.hotFrameIds.has(id);
    const size = input.framePixelSize.get(id);
    const fits = !!size && size.width * bucket <= MAX_TEXTURE_PX && size.height * bucket <= MAX_TEXTURE_PX;
    if (cached && (!quiet || hot || cached.resolutionBucket !== bucket || !fits)) {
      toUncache.push(id);
      continue;
    }
    if (!cached && quiet && !hot && fits) toCache.push({ id, resolutionBucket: bucket });
  }
  return { toCache, toUncache };
}
