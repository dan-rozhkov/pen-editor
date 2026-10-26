import { createStorageFlag } from "@/lib/storageSync";

/**
 * Kill switch for raster caching of quiet top-level frames. Absent = on,
 * "off" = off. Kept out of `src/pixi/` so the Settings document can toggle it
 * without importing Pixi. `pixiSync` reads it once at startup, so a change
 * applies after reload.
 */
export const RASTER_CACHE_KEY = "pen.rasterCache";
export const rasterCacheFlag = createStorageFlag(RASTER_CACHE_KEY, { offValue: "off" });
