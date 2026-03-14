import { Container, Text } from "pixi.js";
import { useViewportStore } from "@/store/viewportStore";
import { getViewportBounds } from "@/utils/viewportUtils";
import { updateEmbedResolution, setEmbedResolution } from "./renderers/embedRenderer";
import { setImageFillResolution, updateImageFillResolution } from "./renderers/imageFillHelpers";
import type { FlatSceneNode, EmbedNode } from "@/types/scene";
import type { SyncContext, RegistryEntry } from "./syncHelpers";
import {
  TEXT_RESOLUTION_SHARPNESS_BOOST,
  TEXT_RESOLUTION_MAX_MULTIPLIER,
  EMBED_RESOLUTION_STEP,
  MIN_EMBED_RESOLUTION,
  EMBED_VIEWPORT_MARGIN,
} from "./syncHelpers";

function createDebouncedTimer(delayMs: number, callback: () => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule(): void {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        callback();
      }, delayMs);
    },
    clear(): void {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

export function createResolutionManager(ctx: SyncContext) {
  let appliedTextResolution = 0;
  let appliedEmbedResolution = 0;
  let appliedImageFillResolution = 0;
  const embedsAtTargetRes = new Set<string>();
  let embedUpgradeGeneration = 0;

  // --- Text resolution ---

  function applyTextResolutionRecursive(container: Container, resolution: number): void {
    for (const child of container.children) {
      if (child instanceof Text) {
        if (child.resolution !== resolution) {
          child.resolution = resolution;
        }
      } else if (child instanceof Container) {
        applyTextResolutionRecursive(child, resolution);
      }
    }
  }

  function getTargetTextResolution(scale: number): number {
    const devicePixelRatio = window.devicePixelRatio || 1;
    const effectiveScale = Math.max(1, scale);
    const maxResolution = Math.ceil(
      devicePixelRatio * TEXT_RESOLUTION_MAX_MULTIPLIER,
    );
    const boostedResolution =
      effectiveScale * devicePixelRatio * TEXT_RESOLUTION_SHARPNESS_BOOST;
    return Math.min(maxResolution, boostedResolution);
  }

  function applyTextResolution(resolution: number): void {
    if (appliedTextResolution === resolution) return;
    appliedTextResolution = resolution;
    applyTextResolutionRecursive(ctx.sceneRoot, resolution);
  }

  function refreshTextResolution(): void {
    const resolution =
      appliedTextResolution ||
      getTargetTextResolution(useViewportStore.getState().scale);
    applyTextResolutionRecursive(ctx.sceneRoot, resolution);
  }

  // --- Embed resolution ---

  function getTargetEmbedResolution(scale: number): number {
    const devicePixelRatio = window.devicePixelRatio || 1;
    const effectiveScale = Math.max(1, scale);
    const maxResolution = Math.ceil(devicePixelRatio * 32);
    return Math.min(maxResolution, effectiveScale * devicePixelRatio);
  }

  function getCurrentViewportBounds() {
    const vp = useViewportStore.getState();
    const w = window.innerWidth;
    const h = window.innerHeight;
    return getViewportBounds(vp.scale, vp.x, vp.y, w, h);
  }

  function getContainerWorldPos(container: Container): { x: number; y: number } {
    let x = 0, y = 0;
    let cur: Container | null = container;
    while (cur && cur !== ctx.sceneRoot) {
      x += cur.position.x;
      y += cur.position.y;
      cur = cur.parent;
    }
    return { x, y };
  }

  function isContainerInViewport(
    container: Container,
    node: FlatSceneNode,
    bounds: { minX: number; maxX: number; minY: number; maxY: number },
  ): boolean {
    const pos = getContainerWorldPos(container);
    return !(
      pos.x + node.width < bounds.minX - EMBED_VIEWPORT_MARGIN ||
      pos.x > bounds.maxX + EMBED_VIEWPORT_MARGIN ||
      pos.y + node.height < bounds.minY - EMBED_VIEWPORT_MARGIN ||
      pos.y > bounds.maxY + EMBED_VIEWPORT_MARGIN
    );
  }

  async function upgradeVisibleEmbeds(onlyNew: boolean): Promise<void> {
    const generation = ++embedUpgradeGeneration;
    if (appliedEmbedResolution <= 0) return;

    const bounds = getCurrentViewportBounds();
    const toUpgrade: Array<{ id: string; entry: RegistryEntry }> = [];

    for (const [id, entry] of ctx.registry) {
      if (entry.node.type !== "embed") continue;
      if (onlyNew && embedsAtTargetRes.has(id)) continue;
      if (!isContainerInViewport(entry.container, entry.node, bounds)) continue;
      toUpgrade.push({ id, entry });
    }

    for (const { id, entry } of toUpgrade) {
      if (embedUpgradeGeneration !== generation) return;
      if (entry.container.destroyed) continue;

      await updateEmbedResolution(
        entry.container,
        entry.node as EmbedNode,
        appliedEmbedResolution,
      );
      embedsAtTargetRes.add(id);
    }
  }

  function applyEmbedResolution(resolution: number): void {
    const normalizedResolution = Math.max(
      MIN_EMBED_RESOLUTION,
      Math.round(resolution / EMBED_RESOLUTION_STEP) * EMBED_RESOLUTION_STEP,
    );
    if (appliedEmbedResolution === normalizedResolution) return;
    appliedEmbedResolution = normalizedResolution;
    setEmbedResolution(normalizedResolution);
    embedsAtTargetRes.clear();
    upgradeVisibleEmbeds(false);
  }

  // --- Image fill resolution ---

  // Image fill resolution uses the same formula as embed resolution.
  const getTargetImageFillResolution = getTargetEmbedResolution;

  function applyImageFillTextureResolution(resolution: number): void {
    if (appliedImageFillResolution === resolution) return;
    appliedImageFillResolution = resolution;
    setImageFillResolution(resolution);
    for (const [, entry] of ctx.registry) {
      if (entry.node.imageFill) {
        updateImageFillResolution(entry.container, entry.node);
      }
    }
  }

  // --- Scheduling ---

  // Mutable scale captured by schedule callbacks; updated by the public schedule* methods.
  let pendingTextScale = 0;
  let pendingEmbedScale = 0;
  let pendingImageFillScale = 0;

  const textTimer = createDebouncedTimer(120, () => {
    applyTextResolution(getTargetTextResolution(pendingTextScale));
  });
  const embedTimer = createDebouncedTimer(200, () => {
    applyEmbedResolution(getTargetEmbedResolution(pendingEmbedScale));
  });
  const imageFillTimer = createDebouncedTimer(200, () => {
    applyImageFillTextureResolution(getTargetImageFillResolution(pendingImageFillScale));
  });
  const panTimer = createDebouncedTimer(200, () => {
    upgradeVisibleEmbeds(true);
  });

  // --- Public API ---

  function clearEmbedCache(id?: string): void {
    if (id !== undefined) {
      embedsAtTargetRes.delete(id);
    } else {
      embedsAtTargetRes.clear();
    }
  }

  function resetResolutions(): void {
    appliedTextResolution = 0;
    appliedEmbedResolution = 0;
    appliedImageFillResolution = 0;
    embedsAtTargetRes.clear();
  }

  function cleanup(): void {
    textTimer.clear();
    embedTimer.clear();
    imageFillTimer.clear();
    panTimer.clear();
    // Cancel any in-flight async embed upgrade loop
    ++embedUpgradeGeneration;
  }

  function getAppliedTextResolution(): number {
    return appliedTextResolution;
  }

  return {
    scheduleTextResolutionUpdate(scale: number): void {
      pendingTextScale = scale;
      textTimer.schedule();
    },
    scheduleEmbedResolutionUpdate(scale: number): void {
      pendingEmbedScale = scale;
      embedTimer.schedule();
    },
    scheduleImageFillResolutionUpdate(scale: number): void {
      pendingImageFillScale = scale;
      imageFillTimer.schedule();
    },
    schedulePanUpgrade(): void {
      panTimer.schedule();
    },

    applyTextResolution,
    applyEmbedResolution,
    applyImageFillTextureResolution,

    refreshTextResolution,
    getTargetTextResolution,
    getTargetEmbedResolution,
    getTargetImageFillResolution,
    getAppliedTextResolution,

    clearEmbedCache,
    resetResolutions,
    cleanup,
  };
}

export type ResolutionManager = ReturnType<typeof createResolutionManager>;
