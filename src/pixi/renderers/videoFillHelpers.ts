import { Container, Graphics, Rectangle, Sprite, Texture, VideoSource } from "pixi.js";
import type { FlatSceneNode, PerCornerRadius, VideoFill } from "@/types/scene";
import { getResolvedRenderableFills } from "./colorHelpers";
import { drawRoundedShape } from "./fillStrokeHelpers";
import { computeFillSpriteLayout } from "@/lib/imageCrop/spriteLayout";
import { withTexture } from "./imageFillHelpers";
import { parseYouTubeId, youTubeThumbnailUrl } from "@/lib/video/youtube";
import { videoPlaybackStarted, videoPlaybackStopped } from "./videoPlaybackLoop";

/**
 * Video-fill renderer. A node's topmost video paint is rendered as a masked
 * PixiJS `Sprite` backed by a live `<video>` element (via `VideoSource`),
 * mirroring the image-fill sprite path (`imageFillHelpers.ts`) but for moving
 * images. Only ONE video paint per node is rendered (the topmost) — additional
 * video paints below it are a documented no-op.
 *
 * Lifecycle is the #1 risk area: every video fill owns a `<video>` DOM element
 * and a GPU texture that MUST be released when the fill is removed, changed to
 * a different source/type, or the node's container is destroyed. All of that
 * routes through `teardownVideo`, and a `container.once("destroyed", …)` hook
 * guarantees cleanup even when the container is torn down by pixiSync without a
 * fill-change event.
 *
 * YOUTUBE SOURCES ARE THE ONE EXCEPTION to all of the above: a YouTube `src`
 * (`parseYouTubeId(video.src)` non-null) can never be played as a `<video>`
 * element — YouTube doesn't serve raw media files, and pointing a `<video>`
 * at a YouTube page URL just errors. Cross-origin canvas playback of
 * YouTube's actual video pixels isn't something the browser allows either.
 * So a YouTube video fill renders its static `hqdefault.jpg` thumbnail on the
 * canvas instead, through the exact texture-load/cache/mask/crop machinery
 * `imageFillHelpers.ts` already uses for image fills (`withTexture`) — see
 * `applyYouTubeThumbnail` below. `applyVideoFill` branches on
 * `parseYouTubeId` BEFORE any `<video>`/`VideoSource` code runs, so a YouTube
 * src never reaches `createVideoState`/`teardownVideo`. The real, playing,
 * clickable YouTube embed only exists in the `designToHtml` export/preview
 * (`generateVideoFillHtml` → `<iframe>`), never inside the WebGL canvas.
 */

const VIDEO_FILL_LABEL = "video-fill";
const VIDEO_MASK_LABEL = "video-mask";

interface VideoFillState {
  el: HTMLVideoElement;
  source: VideoSource;
  /** The full-source texture (never a derived crop/cover frame). */
  baseTexture: Texture;
  /** The currently displayed texture (may be a derived crop/cover sub-frame). */
  derivedTexture?: Texture;
  sprite: Sprite;
  src: string;
  onLoadedMetadata: () => void;
  /** Native play/pause listeners driving `videoPlaybackLoop`'s playing-video
   *  counter (see that module for why: renderScheduler only repaints on a
   *  signal, and a playing video must keep signalling every frame). */
  onPlay: () => void;
  onPause: () => void;
  /** Whether `videoPlaybackStarted` has been called for this element without
   *  a matching `videoPlaybackStopped` yet — lets teardown release the
   *  counter synchronously instead of waiting on the native "pause" event,
   *  which fires asynchronously (after listeners may already be removed). */
  isPlaying: boolean;
}

const stateByContainer = new WeakMap<Container, VideoFillState>();
/** Containers that already have the destroy-cleanup hook attached. */
const destroyHooked = new WeakSet<Container>();

/** Topmost renderable video paint's fill, if any. */
function topVideoFill(node: FlatSceneNode): VideoFill | undefined {
  const fills = getResolvedRenderableFills(node);
  for (let i = fills.length - 1; i >= 0; i--) {
    const p = fills[i];
    if (p.type === "video") return p.video;
  }
  return undefined;
}

/** Fully release a video fill's DOM element, texture, and event listeners. */
function teardownVideo(container: Container): void {
  const state = stateByContainer.get(container);
  if (!state) return;
  stateByContainer.delete(container);

  const { el, source, baseTexture, derivedTexture, sprite, onLoadedMetadata, onPlay, onPause, isPlaying } = state;

  el.removeEventListener("loadedmetadata", onLoadedMetadata);
  el.removeEventListener("play", onPlay);
  el.removeEventListener("pause", onPause);
  // Release this element's slot in the playing-video counter now if it was
  // still playing — el.pause() below fires "pause" asynchronously, after the
  // listener above has already been removed, so it would never decrement.
  if (isPlaying) videoPlaybackStopped();

  // Remove the sprite + mask from the (possibly still-live) container. When the
  // container was already destroyed (children:true), the sprite/mask Graphics
  // are already destroyed too — skip touching them, but STILL release the
  // VideoSource/texture/element below (container.destroy leaves textures alone).
  if (!container.destroyed) {
    const mask = sprite.mask;
    sprite.mask = null;
    if (sprite.parent) container.removeChild(sprite);
    if (mask instanceof Graphics && !mask.destroyed) {
      if (mask.parent) container.removeChild(mask);
      mask.destroy();
    }
    // Destroy the sprite (not its texture — we own that separately below).
    if (!sprite.destroyed) sprite.destroy({ children: false, texture: false });
  }

  // Release the derived sub-frame texture (a plain Texture over the shared
  // source), then the VideoSource (pauses playback, drops the element ref).
  if (derivedTexture && derivedTexture !== baseTexture) derivedTexture.destroy(false);
  baseTexture.destroy(false);
  source.destroy();

  // Detach the media element so the browser can reclaim it promptly.
  el.pause();
  el.removeAttribute("src");
  el.load();
}

/** Remove any video fill from a container (public teardown entry point). */
export function destroyVideoFill(container: Container): void {
  teardownVideo(container);
  teardownYouTubeThumbnail(container);
}

// ─── YouTube thumbnail (image-texture) path ────────────────────────────────

interface YouTubeThumbnailState {
  id: string;
  /** The full-source (uncropped) thumbnail texture, owned by imageFillHelpers'
   *  shared cache — never destroyed here, only the derived crop/cover frame. */
  baseTexture: Texture;
  derivedTexture?: Texture;
  sprite: Sprite;
}

const youtubeStateByContainer = new WeakMap<Container, YouTubeThumbnailState>();
/** Latest requested YouTube id per container, so an in-flight thumbnail load
 *  superseded by a newer src change can detect it's stale and no-op. */
const pendingYouTubeIdByContainer = new WeakMap<Container, string>();

/** Release a YouTube-thumbnail sprite + its derived (crop/cover) texture. The
 *  shared base thumbnail texture is owned by imageFillHelpers' texture cache
 *  and is intentionally NOT destroyed here (mirrors `destroyImageSprite`). */
function teardownYouTubeThumbnail(container: Container): void {
  const state = youtubeStateByContainer.get(container);
  if (!state) return;
  youtubeStateByContainer.delete(container);

  if (container.destroyed) return;

  const { sprite, baseTexture, derivedTexture } = state;
  const mask = sprite.mask;
  sprite.mask = null;
  if (sprite.parent) container.removeChild(sprite);
  if (mask instanceof Graphics && !mask.destroyed) {
    if (mask.parent) container.removeChild(mask);
    mask.destroy();
  }
  if (!sprite.destroyed) sprite.destroy({ children: false, texture: false });
  if (derivedTexture && derivedTexture !== baseTexture) derivedTexture.destroy(false);
}

/** Apply mode/crop geometry to the YouTube thumbnail sprite (same pure layout
 *  math as the real-video path, sourced from the thumbnail's own pixel size
 *  instead of `<video>.videoWidth/videoHeight`). */
function layoutYouTubeSprite(
  state: YouTubeThumbnailState,
  video: VideoFill,
  containerW: number,
  containerH: number,
): void {
  // Thumbnails carry their own pixel size on the base texture.
  applySpriteLayout(state, video, state.baseTexture.width, state.baseTexture.height, containerW, containerH);
}

/**
 * Render a YouTube video fill as its static thumbnail — the canvas cannot
 * play YouTube's actual video (cross-origin, no raw media URL), so this
 * reuses the image-fill texture loader (`withTexture`, with its cache and
 * in-flight dedup) to load `https://img.youtube.com/vi/<id>/hqdefault.jpg`
 * and displays it exactly like an image fill: same fit/crop math, same mask
 * geometry. Fires under the SAME `video-fill` container label as the real
 * `<video>` path (`applyVideoFill`'s two branches are mutually exclusive per
 * container) so z-order code elsewhere that looks up `"video-fill"` keeps
 * working unmodified.
 */
function applyYouTubeThumbnail(
  container: Container,
  video: VideoFill,
  id: string,
  width: number,
  height: number,
  ellipse: boolean,
  cornerRadius?: number,
  cornerRadiusPerCorner?: PerCornerRadius,
  cornerSmoothing?: number,
): void {
  const prev = youtubeStateByContainer.get(container);

  const rebuildMask = (state: YouTubeThumbnailState) =>
    rebuildSpriteMask(container, state.sprite, ellipse, width, height, cornerRadius, cornerRadiusPerCorner, cornerSmoothing);

  // Same thumbnail already mounted → just re-layout/re-mask for the new size.
  if (prev && prev.id === id) {
    layoutYouTubeSprite(prev, video, width, height);
    rebuildMask(prev);
    return;
  }

  // Track the latest requested id so a slow/stale load (superseded by a
  // later src change before this one's texture finished loading) discards
  // itself instead of clobbering the now-current thumbnail.
  pendingYouTubeIdByContainer.set(container, id);

  const thumbnailUrl = youTubeThumbnailUrl(id);
  withTexture(thumbnailUrl, width, height, container, (texture) => {
    if (pendingYouTubeIdByContainer.get(container) !== id) return; // superseded

    teardownYouTubeThumbnail(container);

    const sprite = new Sprite(texture);
    sprite.label = VIDEO_FILL_LABEL;
    const state: YouTubeThumbnailState = { id, baseTexture: texture, sprite };
    youtubeStateByContainer.set(container, state);

    layoutYouTubeSprite(state, video, width, height);
    const index = videoInsertIndex(container);
    container.addChildAt(sprite, Math.min(index, container.children.length));
    rebuildMask(state);
  });
}

function buildMask(
  ellipse: boolean,
  width: number,
  height: number,
  cornerRadius?: number,
  cornerRadiusPerCorner?: PerCornerRadius,
  cornerSmoothing?: number,
): Graphics {
  const mask = new Graphics();
  mask.label = VIDEO_MASK_LABEL;
  if (ellipse) {
    mask.ellipse(width / 2, height / 2, width / 2, height / 2);
  } else {
    drawRoundedShape(mask, width, height, cornerRadius, cornerRadiusPerCorner, cornerSmoothing);
  }
  mask.fill(0xffffff);
  return mask;
}

/** A sprite-backed fill state carrying the textures the layout helper mutates. */
type SpriteLayoutState = { sprite: Sprite; baseTexture: Texture; derivedTexture?: Texture };

/**
 * Apply mode/crop geometry to a sprite via the shared pure layout math,
 * deriving a cropped sub-frame texture when needed and releasing the previous
 * one. Shared by the real-video and YouTube-thumbnail paths — they differ only
 * in how the source pixel size (`sourceW`/`sourceH`) is obtained.
 */
function applySpriteLayout(
  state: SpriteLayoutState,
  video: VideoFill,
  sourceW: number,
  sourceH: number,
  containerW: number,
  containerH: number,
): void {
  const layout = computeFillSpriteLayout(video.mode, video.crop, sourceW, sourceH, containerW, containerH);

  const prevDerived = state.derivedTexture;
  let derived: Texture | undefined;
  if (layout.frame) {
    derived = new Texture({
      source: state.baseTexture.source,
      frame: new Rectangle(layout.frame.x, layout.frame.y, layout.frame.width, layout.frame.height),
    });
    state.sprite.texture = derived;
  } else {
    state.sprite.texture = state.baseTexture;
  }
  state.derivedTexture = derived;
  if (prevDerived && prevDerived !== derived && prevDerived !== state.baseTexture) {
    prevDerived.destroy(false);
  }

  state.sprite.x = layout.dest.x;
  state.sprite.y = layout.dest.y;
  state.sprite.width = layout.dest.width;
  state.sprite.height = layout.dest.height;
}

/** Rebuild a sprite's clip mask (remove the old Graphics mask, build + attach a
 *  new one just above the sprite). Shared by both fill paths. */
function rebuildSpriteMask(
  container: Container,
  sprite: Sprite,
  ellipse: boolean,
  width: number,
  height: number,
  cornerRadius?: number,
  cornerRadiusPerCorner?: PerCornerRadius,
  cornerSmoothing?: number,
): void {
  const oldMask = sprite.mask;
  if (oldMask instanceof Graphics) {
    if (oldMask.parent) container.removeChild(oldMask);
    oldMask.destroy();
  }
  const mask = buildMask(ellipse, width, height, cornerRadius, cornerRadiusPerCorner, cornerSmoothing);
  container.addChildAt(mask, container.getChildIndex(sprite) + 1);
  sprite.mask = mask;
}

/** Apply mode/crop geometry to the sprite using the shared pure layout math. */
function layoutVideoSprite(
  state: VideoFillState,
  video: VideoFill,
  containerW: number,
  containerH: number,
): void {
  // Prefer the live element's intrinsic size; fall back to the texture/box
  // before `loadedmetadata` has fired.
  const sourceW = state.el.videoWidth || state.baseTexture.width || containerW;
  const sourceH = state.el.videoHeight || state.baseTexture.height || containerH;
  applySpriteLayout(state, video, sourceW, sourceH, containerW, containerH);
}

/** Insertion index: above background + any image fill, below child nodes. */
function videoInsertIndex(container: Container): number {
  const imageFill = container.getChildByLabel("image-fill");
  if (imageFill) return container.getChildIndex(imageFill) + 1;
  const bg =
    container.getChildByLabel("rect-bg") ??
    container.getChildByLabel("ellipse-bg") ??
    container.getChildByLabel("frame-bg");
  if (bg) return container.getChildIndex(bg) + 1;
  return 0;
}

/** Apply the live playback flags from the fill onto the `<video>` element. */
function applyPlaybackFlags(el: HTMLVideoElement, video: VideoFill): void {
  el.loop = video.playback.loop;
  // Unmuted autoplay is blocked by browsers — force muted when autoplaying.
  el.muted = video.playback.muted || video.playback.autoplay;
  if (video.playback.autoplay) {
    const p = el.play();
    if (p && typeof p.catch === "function") p.catch(() => { /* autoplay may be blocked */ });
  } else {
    el.pause();
  }
}

function createVideoState(video: VideoFill): VideoFillState {
  const el = document.createElement("video");
  el.crossOrigin = "anonymous";
  el.playsInline = true;
  el.loop = video.playback.loop;
  el.muted = video.playback.muted || video.playback.autoplay;
  el.autoplay = video.playback.autoplay;
  el.preload = "auto";
  el.src = video.src;

  const source = new VideoSource({
    resource: el,
    autoPlay: video.playback.autoplay,
    loop: video.playback.loop,
    muted: video.playback.muted || video.playback.autoplay,
    playsinline: true,
    crossorigin: true,
    // Update the texture at the native frame rate (0 = every render).
    updateFPS: 0,
  });
  const baseTexture = new Texture({ source });
  const sprite = new Sprite(baseTexture);
  sprite.label = VIDEO_FILL_LABEL;

  const state: VideoFillState = {
    el,
    source,
    baseTexture,
    sprite,
    src: video.src,
    onLoadedMetadata: () => { /* replaced below */ },
    onPlay: () => { /* replaced below */ },
    onPause: () => { /* replaced below */ },
    isPlaying: false,
  };
  return state;
}

/**
 * Apply the node's topmost video paint to a container. `ellipse` selects the
 * clip geometry. Handles create / src-change / in-place resize / removal, and
 * releases all media + GPU resources on teardown.
 */
function applyVideoFill(
  container: Container,
  node: FlatSceneNode,
  width: number,
  height: number,
  ellipse: boolean,
  cornerRadius?: number,
  cornerRadiusPerCorner?: PerCornerRadius,
  cornerSmoothing?: number,
): void {
  const video = topVideoFill(node);
  const prev = stateByContainer.get(container);
  const prevYouTube = youtubeStateByContainer.get(container);

  if (!video || !video.src) {
    if (prev) teardownVideo(container);
    if (prevYouTube) teardownYouTubeThumbnail(container);
    return;
  }

  // Ensure the container tears down whichever fill it owns if it is
  // destroyed out from under us (pixiSync destroys containers without a
  // fill-change event). Registered once regardless of which branch below
  // ends up mounting, since a container can switch between the two.
  if (!destroyHooked.has(container)) {
    destroyHooked.add(container);
    container.once("destroyed", () => {
      teardownVideo(container);
      teardownYouTubeThumbnail(container);
    });
  }

  // A YouTube src can never be a `<video>` element (see the module doc
  // comment) — branch here, BEFORE any `<video>`/`VideoSource` code, to the
  // static-thumbnail (image-texture) path instead.
  const youtubeId = parseYouTubeId(video.src);
  if (youtubeId) {
    if (prev) teardownVideo(container);
    applyYouTubeThumbnail(
      container,
      video,
      youtubeId,
      width,
      height,
      ellipse,
      cornerRadius,
      cornerRadiusPerCorner,
      cornerSmoothing,
    );
    return;
  }
  if (prevYouTube) teardownYouTubeThumbnail(container);

  const rebuildMask = (state: VideoFillState) =>
    rebuildSpriteMask(container, state.sprite, ellipse, width, height, cornerRadius, cornerRadiusPerCorner, cornerSmoothing);

  // Same source already mounted → update playback + geometry in place.
  if (prev && prev.src === video.src) {
    applyPlaybackFlags(prev.el, video);
    layoutVideoSprite(prev, video, width, height);
    rebuildMask(prev);
    return;
  }

  // New / changed source → tear down the old one and mount fresh.
  if (prev) teardownVideo(container);

  const state = createVideoState(video);
  stateByContainer.set(container, state);

  const relayout = () => {
    if (container.destroyed || stateByContainer.get(container) !== state) return;
    layoutVideoSprite(state, video, width, height);
    rebuildMask(state);
  };
  state.onLoadedMetadata = () => {
    // Re-run layout once the real video dimensions are known (crop/fit math
    // needs the natural size, which is 0 until metadata loads).
    relayout();
  };
  state.el.addEventListener("loadedmetadata", state.onLoadedMetadata);

  // Drive the playing-video counter (`videoPlaybackLoop`) off the element's
  // OWN play/pause state rather than the `autoplay` flag — this is correct
  // even when autoplay is blocked by the browser (no "play" event ⇒ never
  // counted) and when a non-looping video reaches its end ("pause" fires
  // alongside "ended", so no separate "ended" listener is needed).
  state.onPlay = () => {
    if (!state.isPlaying) {
      state.isPlaying = true;
      videoPlaybackStarted();
    }
  };
  state.onPause = () => {
    if (state.isPlaying) {
      state.isPlaying = false;
      videoPlaybackStopped();
    }
  };
  state.el.addEventListener("play", state.onPlay);
  state.el.addEventListener("pause", state.onPause);

  // Initial placement (best-effort with whatever size is known so far).
  layoutVideoSprite(state, video, width, height);
  const index = videoInsertIndex(container);
  container.addChildAt(state.sprite, Math.min(index, container.children.length));
  rebuildMask(state);
  applyPlaybackFlags(state.el, video);
}

/** Apply the node's video fill to a rect/frame container. */
export function applyVideoFills(
  container: Container,
  node: FlatSceneNode,
  width: number,
  height: number,
  cornerRadius?: number,
  cornerRadiusPerCorner?: PerCornerRadius,
  cornerSmoothing?: number,
): void {
  applyVideoFill(container, node, width, height, false, cornerRadius, cornerRadiusPerCorner, cornerSmoothing);
}

/** Apply the node's video fill to an ellipse container. */
export function applyVideoFillsEllipse(
  container: Container,
  node: FlatSceneNode,
  width: number,
  height: number,
): void {
  applyVideoFill(container, node, width, height, true);
}
