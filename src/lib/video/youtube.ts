import type { VideoPlayback } from "@/types/scene";

/**
 * YouTube support for the `VIDEO` fill (`VideoFill.src`). A video fill's
 * `src` may be an uploaded file (`data:`/`blob:`/`https://.../file.mp4`) OR a
 * YouTube watch/short/embed URL — this module is the single source of truth
 * for detecting the latter and deriving the URLs the renderer and exporter
 * need. Deliberately framework/Pixi-free so it's unit-testable without WebGL.
 *
 * No new discriminator field was added to `VideoFill`: a YouTube fill is
 * still just `{ src: "https://youtu.be/...", mode, playback }` — callers
 * detect it on the fly via `parseYouTubeId`, exactly like uploaded videos are
 * detected by simply being playable `src` values.
 */

const YOUTUBE_HOSTS = new Set(["youtube.com", "youtube-nocookie.com"]);
const YOUTUBE_SHORT_HOST = "youtu.be";

/** A YouTube video id is `[A-Za-z0-9_-]`, conventionally 11 chars — accept a
 *  slightly loose minimum so future/regional id formats aren't rejected. */
function isPlausibleId(id: string | undefined | null): id is string {
  return !!id && /^[A-Za-z0-9_-]{6,}$/.test(id);
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\.|^m\./, "");
}

/**
 * Extract the video id from a YouTube URL of any known shape:
 * `youtube.com/watch?v=ID`, `youtu.be/ID`, `youtube.com/embed/ID`,
 * `youtube.com/shorts/ID` (and the `youtube-nocookie.com` privacy host).
 * Returns `null` for anything else (uploaded-file `src`, other hosts,
 * malformed URLs) — callers use this to decide whether to take the
 * YouTube-thumbnail/iframe path at all.
 */
export function parseYouTubeId(src: string): string | null {
  if (!src) return null;

  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null;
  }

  const host = normalizeHost(url.hostname);

  if (host === YOUTUBE_SHORT_HOST) {
    const id = url.pathname.replace(/^\//, "").split("/")[0];
    return isPlausibleId(id) ? id : null;
  }

  if (!YOUTUBE_HOSTS.has(host)) return null;

  if (url.pathname === "/watch") {
    const id = url.searchParams.get("v");
    return isPlausibleId(id) ? id : null;
  }

  const embedMatch = url.pathname.match(/^\/embed\/([^/?#]+)/);
  if (embedMatch) return isPlausibleId(embedMatch[1]) ? embedMatch[1] : null;

  const shortsMatch = url.pathname.match(/^\/shorts\/([^/?#]+)/);
  if (shortsMatch) return isPlausibleId(shortsMatch[1]) ? shortsMatch[1] : null;

  return null;
}

/** Static thumbnail URL for the canvas texture (image-fill path — no
 *  cross-origin video pixels are ever pulled into WebGL). */
export function youTubeThumbnailUrl(id: string): string {
  return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
}

/**
 * Build the `youtube.com/embed/<id>` URL used by the designToHtml exporter's
 * `<iframe>`, mapping the fill's `playback` config to embed params:
 * - `autoplay=1` (+ forced `mute=1`, mirroring the `<video>` path's forced
 *   mute — browsers block unmuted autoplay).
 * - `loop=1&playlist=<id>` (YouTube requires `playlist` to contain the same
 *   id for a *single* video to loop).
 * - `controls=1` always — this is a real clickable player, unlike the muted
 *   background `<video>` it replaces.
 *
 * SECURITY: `id` must be the id already extracted by `parseYouTubeId` — never
 * pass a raw user-supplied URL/string here, since it is interpolated
 * directly into the iframe `src`.
 */
export function youTubeEmbedUrl(id: string, playback: VideoPlayback): string {
  const params = new URLSearchParams({
    autoplay: playback.autoplay ? "1" : "0",
    loop: playback.loop ? "1" : "0",
    controls: "1",
    rel: "0",
    playsinline: "1",
  });
  if (playback.autoplay || playback.muted) params.set("mute", "1");
  if (playback.loop) params.set("playlist", id);
  return `https://www.youtube.com/embed/${id}?${params.toString()}`;
}
