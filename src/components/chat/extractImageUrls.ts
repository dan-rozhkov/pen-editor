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

// Keys that carry the page an image was cited from (Mobbin's `mobbin_url`).
const SOURCE_URL_KEYS = ["mobbin_url", "source_url", "page_url"];

/** image url -> citation page url, filled as a side channel by the walker. */
type SourceMap = Map<string, string>;

function extractImageUrlsFromParsed(
  value: unknown,
  sources: SourceMap,
  keyHint = "",
  inheritedSource?: string,
): string[] {
  const urls = new Set<string>();

  if (typeof value === "string") {
    // MCP tool results wrap their payload as JSON *text* inside
    // `content:[{type:"text", text:"{...}"}]`; look inside it.
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const inner: unknown = JSON.parse(trimmed);
        for (const url of extractImageUrlsFromParsed(inner, sources, keyHint, inheritedSource)) {
          urls.add(url);
        }
      } catch {
        // not JSON after all - fall through to the plain-text scan
      }
    }
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
      for (const url of extractImageUrlsFromParsed(item, sources, keyHint, inheritedSource)) {
        urls.add(url);
      }
    }
    return [...urls];
  }

  if (!value || typeof value !== "object") {
    return [...urls];
  }

  const record = value as Record<string, unknown>;
  const sourceKey = SOURCE_URL_KEYS.find(
    (k) => typeof record[k] === "string" && /^https?:\/\//i.test(record[k] as string),
  );
  // A closer citation wins; otherwise inherit the nearest ancestor's.
  const sourceUrl = sourceKey ? (record[sourceKey] as string) : inheritedSource;

  for (const [key, raw] of Object.entries(record)) {
    if (typeof raw === "string" && isImageHref(raw)) {
      const keyLc = key.toLowerCase();
      if (looksLikeImageUrl(raw) || keyLc.includes("thumbnail") || keyLc.includes("image")) {
        urls.add(raw);
        if (sourceUrl && !sources.has(raw)) sources.set(raw, sourceUrl);
      }
    }
    for (const url of extractImageUrlsFromParsed(raw, sources, key, sourceUrl)) {
      urls.add(url);
    }
  }

  return [...urls];
}

export interface ImageRef {
  url: string;
  /** Citation page the image was found on, when the tool result names one. */
  sourceUrl?: string;
}

/** Like extractImageUrls, but pairs each image with its citation URL. */
export function extractImageRefs(value: unknown): ImageRef[] {
  const parsed = (() => {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  })();

  const sources: SourceMap = new Map();
  const urls = new Set(extractImageUrlsFromParsed(parsed, sources));
  return [...urls].map((url) => {
    const sourceUrl = sources.get(url);
    return sourceUrl ? { url, sourceUrl } : { url };
  });
}

export function extractImageUrls(value: unknown): string[] {
  return extractImageRefs(value).map((r) => r.url);
}
