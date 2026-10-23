import { useCallback, useEffect, useRef } from "react";
import { useSceneStore } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useViewportStore } from "@/store/viewportStore";
import { getNodeAbsolutePositionWithLayout } from "@/utils/nodeUtils";
import {
  claimLiveRun,
  consumeEmbedGenerationReveal,
  markEmbedForGenerationReveal,
  revealGeometryKey,
} from "@/lib/embedGenerationReveal";
import { generate, type UIGenerationLiveRun } from "@/vendor/uiGeneration/ui-generation.js";
import "@/vendor/uiGeneration/ui-generation.css";

/** Drawing time of the full pass, used when no streamed drawing is there to take over. */
const REVEAL_DURATION_MS = 1800;
/** How long a landed embed waits for its streaming preview to hand over the drawing. */
const CLAIM_TIMEOUT_MS = 700;
const HIDE_MASK = "linear-gradient(rgba(0,0,0,0),rgba(0,0,0,0))";
/** Full passes (no streamed drawing to take over) that may run at once; more screens just appear. */
const MAX_FULL_PASSES = 2;
let fullPasses = 0;

/**
 * Whether a pass can play now. Not under reduced motion (the stream is shown
 * as before then), and not in a background tab: timers there are throttled
 * and frames never come, so a hidden screen would stay hidden.
 */
function canPlay(): boolean {
  if (typeof document !== "undefined" && document.hidden) return false;
  try {
    return !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}

/** Only top-level screens stream a preview (pending headers are parsed for `I(document, …)`). */
function isRootScreen(nodeId: string): boolean {
  return !useSceneStore.getState().parentById[nodeId];
}

function viewportScale(): number {
  return useViewportStore.getState().scale || 1;
}

/** The node's scene-space rect, keyed the way the streaming preview parks its run. */
function nodeRevealKey(nodeId: string): string | null {
  const scene = useSceneStore.getState();
  const node = scene.nodesById[nodeId];
  if (!node) return null;
  const calc = useLayoutStore.getState().calculateLayoutForFrame;
  const abs = getNodeAbsolutePositionWithLayout(scene.getNodes(), nodeId, calc);
  return abs ? revealGeometryKey(abs.x, abs.y, node.width, node.height) : null;
}

interface Pending {
  content: HTMLElement;
  mask: { maskImage: string; webkitMaskImage: string };
  start: ReturnType<typeof setTimeout> | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
  release: () => void;
}

/**
 * Finishes the "agent is generating this" pass on a freshly created agent
 * embed (see `src/lib/embedGenerationReveal.ts`). The new screen is hidden at
 * once. Its streaming preview hands over the live wireframe drawing it ran
 * while the html streamed, and the scan line reveals the screen from the top
 * down. With no drawing to take over (no stream), the full pass runs over the
 * hidden screen instead, at most `MAX_FULL_PASSES` at a time. Nested screens,
 * reduced motion and background tabs get no pass: the screen just appears.
 *
 * The overlay cannot live inside the embed host: children of a shadow host
 * are never rendered, and the host clips at its own edges while the drawing
 * runs ~44 px past them. So it gets a light-DOM sibling box. The drawing is
 * measured in screen px at the zoom it started at, and `syncOverlay` (called
 * from the host's position sync) keeps that box on the host and rescales it by
 * `scale / startScale` when the user pans or zooms.
 */
export function useEmbedGenerationReveal(nodeId: string) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const runRef = useRef<{ cancel: () => void; startScale: number } | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const armedRef = useRef(false);
  const startedRef = useRef(false);

  const syncOverlay = useCallback((host: HTMLElement, scale: number) => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.style.left = host.style.left;
    overlay.style.top = host.style.top;
    const active = runRef.current;
    overlay.style.transform = active ? `scale(${scale / active.startScale})` : "";
  }, []);

  const dropPending = useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    pendingRef.current = null;
    clearTimeout(p.start);
    clearTimeout(p.timer);
    p.release();
    p.content.style.maskImage = p.mask.maskImage;
    p.content.style.webkitMaskImage = p.mask.webkitMaskImage;
  }, []);

  const cancelReveal = useCallback(() => {
    dropPending();
    runRef.current?.cancel();
    runRef.current = null;
  }, [dropPending]);

  useEffect(() => {
    const consumed = consumeEmbedGenerationReveal(nodeId);
    armedRef.current = consumed;
    startedRef.current = false;
    return () => {
      armedRef.current = false;
      // StrictMode mounts, unmounts and mounts again before any frame: give
      // the mark back so the second mount still plays the pass.
      if (consumed && !startedRef.current) markEmbedForGenerationReveal(nodeId);
    };
  }, [nodeId]);

  /** Called by the host right after it mounted new content. */
  const attachReveal = useCallback(
    (content: HTMLElement) => {
      if (!armedRef.current) return;
      armedRef.current = false;
      if (!canPlay() || !isRootScreen(nodeId)) {
        startedRef.current = true; // decided: the screen just appears, the mark is spent
        return;
      }
      const pending: Pending = {
        content,
        mask: {
          maskImage: content.style.maskImage,
          webkitMaskImage: content.style.webkitMaskImage,
        },
        start: undefined,
        timer: undefined,
        release: () => {},
      };
      pendingRef.current = pending;
      // Hidden before the first paint: the screen must not flash in ahead of the pass.
      content.style.maskImage = HIDE_MASK;
      content.style.webkitMaskImage = HIDE_MASK;

      const begin = (
        start: (mount: HTMLDivElement) => {
          cancel: () => void;
          startScale: number;
        },
      ) => {
        const mount = overlayRef.current;
        if (pendingRef.current !== pending || !mount) return;
        dropPending(); // the run takes over the mask in the same task: no frame shows the screen
        runRef.current = start(mount);
      };
      const takeOver = (run: UIGenerationLiveRun) =>
        begin((mount) => {
          run.adopt(mount);
          mount.style.transform = `scale(${viewportScale() / run.scale})`;
          void run.complete(content, viewportScale()).then(() => {
            if (runRef.current?.cancel === run.cancel) runRef.current = null;
          });
          return { cancel: run.cancel, startScale: run.scale };
        });
      const fullPass = () => {
        if (fullPasses >= MAX_FULL_PASSES) {
          if (pendingRef.current === pending) dropPending();
          return;
        }
        begin((mount) => {
          const scale = viewportScale();
          fullPasses++;
          mount.style.transform = "";
          const run = generate(content, {
            mount,
            scale,
            duration: REVEAL_DURATION_MS,
            hidden: true,
            // Guides and corner handles would read as the layer's selection and resize handles.
            chrome: false,
            keys: 0,
          });
          void run.finished.then(() => {
            fullPasses--;
            if (runRef.current?.cancel === run.cancel) runRef.current = null;
          });
          return { cancel: run.cancel, startScale: scale };
        });
      };

      // After this task: the host has its rect and the scene its layout. A
      // timer, not a frame: frames never come in a background tab.
      pending.start = setTimeout(() => {
        startedRef.current = true;
        const key = nodeRevealKey(nodeId);
        if (!key) return fullPass();
        pending.release = claimLiveRun(key, takeOver);
        if (pendingRef.current === pending) {
          pending.timer = setTimeout(() => {
            pending.release();
            fullPass();
          }, CLAIM_TIMEOUT_MS);
        }
      }, 0);
    },
    [nodeId, dropPending],
  );

  useEffect(() => cancelReveal, [cancelReveal]);

  return { overlayRef, syncOverlay, attachReveal, cancelReveal };
}
