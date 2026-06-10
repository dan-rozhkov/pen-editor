import { useState, useEffect } from 'react'

const imageCache = new Map<string, HTMLImageElement>()

/**
 * Load an image from a URL (data URI or remote).
 * Returns the loaded HTMLImageElement or null while loading/on error.
 * Caches loaded images to avoid re-fetching.
 */
export function useLoadImage(url: string | undefined): HTMLImageElement | null {
  // Track the result per-URL; the returned image is derived during render so
  // no setState is needed inside the effect body itself.
  const [loaded, setLoaded] = useState<{
    url: string
    image: HTMLImageElement | null
  } | null>(null)

  useEffect(() => {
    if (!url) return
    if (imageCache.has(url)) return

    let cancelled = false
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      imageCache.set(url, img)
      if (!cancelled) {
        setLoaded({ url, image: img })
      }
    }
    img.onerror = () => {
      if (!cancelled) {
        setLoaded({ url, image: null })
      }
    }
    img.src = url
    return () => {
      cancelled = true
    }
  }, [url])

  if (!url) return null
  if (loaded?.url === url) return loaded.image
  return imageCache.get(url) ?? null
}
