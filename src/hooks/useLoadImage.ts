import { useState, useEffect, useRef } from 'react'

const imageCache = new Map<string, HTMLImageElement>()

/**
 * Load an image from a URL (data URI or remote).
 * Returns the loaded HTMLImageElement or null while loading/on error.
 * Caches loaded images to avoid re-fetching.
 */
export function useLoadImage(url: string | undefined): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(() => {
    if (!url) return null
    return imageCache.get(url) ?? null
  })
  const urlRef = useRef(url)

  useEffect(() => {
    urlRef.current = url
    if (!url) {
      setImage(null)
      return
    }

    const cached = imageCache.get(url)
    if (cached) {
      setImage(cached)
      return
    }

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      imageCache.set(url, img)
      if (urlRef.current === url) {
        setImage(img)
      }
    }
    img.onerror = () => {
      if (urlRef.current === url) {
        setImage(null)
      }
    }
    img.src = url
  }, [url])

  return image
}
