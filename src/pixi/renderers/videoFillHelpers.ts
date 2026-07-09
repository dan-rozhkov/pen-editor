import { Container, Graphics, Rectangle, Sprite, Texture, VideoSource } from "pixi.js";
import type { FlatSceneNode, PerCornerRadius, VideoFill } from "@/types/scene";
import { getResolvedRenderableFills } from "./colorHelpers";
import { drawRoundedShape } from "./fillStrokeHelpers";
import { computeFillSpriteLayout } from "@/lib/imageCrop/spriteLayout";

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

  const { el, source, baseTexture, derivedTexture, sprite, onLoadedMetadata } = state;

  el.removeEventListener("loadedmetadata", onLoadedMetadata);

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

/** Apply mode/crop geometry to the sprite using the shared pure layout math. */
function layoutVideoSprite(
  state: VideoFillState,
  video: VideoFill,
  containerW: number,
  containerH: number,
): void {
  const sourceW = state.el.videoWidth || state.baseTexture.width || containerW;
  const sourceH = state.el.videoHeight || state.baseTexture.height || containerH;
  const layout = computeFillSpriteLayout(
    video.mode,
    video.crop,
    sourceW,
    sourceH,
    containerW,
    containerH,
  );

  const prevDerived = state.derivedTexture;
  let derived: Texture | undefined;
  if (layout.frame) {
    derived = new Texture({
      source: state.baseTexture.source,
      frame: new Rectangle(
        layout.frame.x,
        layout.frame.y,
        layout.frame.width,
        layout.frame.height,
      ),
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

  if (!video || !video.src) {
    if (prev) teardownVideo(container);
    return;
  }

  // Ensure the container tears the video down if it is destroyed out from under
  // us (pixiSync destroys containers without a fill-change event).
  if (!destroyHooked.has(container)) {
    destroyHooked.add(container);
    container.once("destroyed", () => teardownVideo(container));
  }

  const rebuildMask = (state: VideoFillState) => {
    const oldMask = state.sprite.mask;
    if (oldMask instanceof Graphics) {
      if (oldMask.parent) container.removeChild(oldMask);
      oldMask.destroy();
    }
    const mask = buildMask(ellipse, width, height, cornerRadius, cornerRadiusPerCorner, cornerSmoothing);
    container.addChildAt(mask, container.getChildIndex(state.sprite) + 1);
    state.sprite.mask = mask;
  };

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
