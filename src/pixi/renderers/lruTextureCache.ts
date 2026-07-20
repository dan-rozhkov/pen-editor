import type { Texture } from "pixi.js";

/**
 * A capacity-bounded LRU cache of PixiJS textures keyed by string. Shared by
 * `imageFillHelpers.ts` and `htmlTexture/renderHtmlToTexture.ts`, whose keys
 * (url+size+resolution, or html+size+resolution) would otherwise grow the
 * cache without limit across interactive resize/zoom/edits.
 */
export class LruTextureCache {
  private readonly cache = new Map<string, Texture>();
  private readonly maxEntries: number;

  constructor(maxEntries: number) {
    this.maxEntries = maxEntries;
  }

  /** Lookup that refreshes the entry's LRU position. */
  get(key: string): Texture | undefined {
    const texture = this.cache.get(key);
    if (texture) {
      // Refresh LRU position
      this.cache.delete(key);
      this.cache.set(key, texture);
    }
    return texture;
  }

  /** Raw lookup without refreshing LRU order. */
  peek(key: string): Texture | undefined {
    return this.cache.get(key);
  }

  set(key: string, texture: Texture): void {
    this.cache.delete(key);
    this.cache.set(key, texture);
    // Evict oldest entries without destroying — live sprites may still reference
    // them; Pixi's texture GC reclaims unused GPU memory once unreferenced.
    while (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
    }
  }

  delete(key: string): void {
    this.cache.delete(key);
  }
}
