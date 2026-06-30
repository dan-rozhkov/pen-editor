const GENERIC_URL_RE = /https?:\/\/[^\s"'<>]+/gi;

// A renderable image reference is either a hosted http(s) URL or an inline
// data:image/ URL (the generation tools return the latter when S3 is off).
function isImageHref(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^data:image\//i.test(value);
}

function looksLikeImageUrl(value: string): boolean {
  const v = value.toLowerCase();
  if (v.startsWith("data:image/")) return true;
  if (/\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(v)) return true;
  return (
    v.includes("thumbnail") ||
    v.includes("screenshot") ||
    v.includes("/images/") ||
    v.includes("/image/")
  );
}

function extractImageUrlsFromParsed(value: unknown, keyHint = ""): string[] {
  const urls = new Set<string>();

  if (typeof value === "string") {
    if (looksLikeImageUrl(value) && isImageHref(value)) {
      urls.add(value);
    }
    for (const match of value.matchAll(GENERIC_URL_RE)) {
      const url = match[0];
      if (looksLikeImageUrl(url)) urls.add(url);
    }
    return [...urls];
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      for (const url of extractImageUrlsFromParsed(item, keyHint)) {
        urls.add(url);
      }
    }
    return [...urls];
  }

  if (!value || typeof value !== "object") {
    return [...urls];
  }

  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string" && isImageHref(raw)) {
      const keyLc = key.toLowerCase();
      if (looksLikeImageUrl(raw) || keyLc.includes("thumbnail") || keyLc.includes("image")) {
        urls.add(raw);
      }
    }
    for (const url of extractImageUrlsFromParsed(raw, key)) {
      urls.add(url);
    }
  }

  return [...urls];
}

export function extractImageUrls(value: unknown): string[] {
  const urls = new Set<string>();
  const parsed = (() => {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  })();

  for (const url of extractImageUrlsFromParsed(parsed)) {
    urls.add(url);
  }
  return [...urls];
}
