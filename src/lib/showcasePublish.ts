// Shared core for publishing canvas screens to the public showcase gallery
// (`POST /api/showcase/publish`, backend-owned). Two callers drive this:
// the AI agent's `publish_to_showcase` tool (`src/lib/tools/publishToShowcase.ts`,
// which only parses/validates the model's loosely-typed args before calling
// in here) and the deterministic "Publish to Showcase" button in the
// properties panel (`src/components/properties/ShowcasePublishSection.tsx`).
// Both need the identical pipeline — validation, size checks, HTML
// extraction, rasterization at 2x, and the POST itself — so it lives once,
// here. This module must never throw; every failure comes back as
// `{ ok: false, error }`.
//
// It is the inverse of `src/lib/importShowcaseScreens.ts`, which pulls
// gallery screens *back* into the editor as embed nodes.
import { toast } from "sonner";
import { useSceneStore } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useCanvasRefStore } from "@/store/canvasRefStore";
import { getNodeEffectiveSize } from "@/utils/nodeUtils";
import { renderNodeToCanvas } from "@/utils/exportUtils";
import { captureEmbedCanvas } from "@/lib/embedScreenshot";
import { convertDesignNodesToHtml } from "@/lib/designToHtml";
import { buildVariableStyleBlock } from "@/utils/variableCssUtils";
import { getEffectiveThemeForNode } from "@/utils/nodeThemeUtils";
import { resolveApiUrl, isOffline } from "@/lib/apiBase";
import { getUserId } from "@/lib/userId";
import type { EmbedNode } from "@/types/scene";

// Owned by pen-editor-backend/src/showcase/platform.ts (SHOWCASE_VIEWPORTS) —
// duplicated here rather than imported, since this repo must not depend on
// the backend repo outside the contract test. Keep these two in sync by
// hand if the backend ever changes them.
export const SHOWCASE_VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  desktop: { width: 1440, height: 1024 },
} as const;

export type ShowcasePlatform = keyof typeof SHOWCASE_VIEWPORTS;

export const SHOWCASE_MAX_SCREENS = 5;
const SIZE_TOLERANCE = 1;
const PIXEL_TOLERANCE = 2;

export interface ShowcasePublishScreen {
  nodeId: string;
  title: string;
  cover?: boolean;
}

export interface ShowcasePublishRequest {
  theme: string;
  prompt?: string;
  platform?: ShowcasePlatform;
  screens: ShowcasePublishScreen[];
}

export type ShowcasePublishOutcome =
  | { ok: true; runId: string; theme: string; screens: { title: string; imageUrl: string }[] }
  | { ok: false; error: string };

/** Wrap a design-node HTML fragment (from convertDesignNodesToHtml) into a
 * full document sized to the viewport, for storage as the screen's
 * `htmlContent`. */
function wrapFragmentAsDocument(fragment: string, width: number, height: number): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${width}, initial-scale=1">
<style>
  html, body { margin: 0; padding: 0; }
  /* A background painted directly on <body> is silently dropped by the
     showcase screenshot pipeline (showcase-body-background-image-never-renders) —
     any full-bleed background belongs on a child div inside the wrapper, not here. */
  body {
    width: ${width}px;
    height: ${height}px;
    overflow: hidden;
  }
  /* WebKit's height:100% fights box-sizing:border-box (showcase Safari
     clipping history) — pin the wrapper to explicit pixel dimensions instead
     of a percentage so nothing gets clipped by a few px in Safari. */
  #pen-publish-root {
    width: ${width}px;
    height: ${height}px;
    box-sizing: border-box;
    overflow: hidden;
    position: relative;
  }
</style>
</head>
<body>
<div id="pen-publish-root">
${fragment}
</div>
</body>
</html>`;
}

interface ResolvedScreen {
  nodeId: string;
  title: string;
  cover: boolean;
  sourceWidth: number;
  sourceHeight: number;
  htmlContent: string;
  rasterHtmlContent: string;
}

function viewportNormalizationStyle(
  source: { width: number; height: number },
  target: { width: number; height: number },
): string {
  if (matchesViewport(source, target)) return "";
  const scaleX = target.width / source.width;
  const scaleY = target.height / source.height;
  return `<style data-pen-showcase-viewport>
html, body {
  width: ${source.width}px !important;
  height: ${source.height}px !important;
  overflow: hidden !important;
}
body {
  transform: scale(${scaleX}, ${scaleY}) !important;
  transform-origin: 0 0 !important;
}
</style>`;
}

function normalizeCanvasToViewport(
  source: HTMLCanvasElement,
  viewport: { width: number; height: number },
  resolution: number,
): HTMLCanvasElement {
  const width = Math.round(viewport.width * resolution);
  const height = Math.round(viewport.height * resolution);
  if (source.width === width && source.height === height) return source;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create a canvas for showcase viewport normalization");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, source.width, source.height, 0, 0, width, height);
  return canvas;
}

/**
 * The full publish pipeline shared by the agent tool and the panel button.
 * Never throws — every failure path returns `{ ok: false, error }`. Fires a
 * single success toast (both callers rely on this — neither should add its
 * own, or a publish would toast twice).
 */
export async function publishScreensToShowcase(
  req: ShowcasePublishRequest,
): Promise<ShowcasePublishOutcome> {
  const theme = req.theme?.trim();
  if (!theme) {
    return { ok: false, error: "theme is required" };
  }

  const platform: ShowcasePlatform = req.platform ?? "mobile";
  const viewport = SHOWCASE_VIEWPORTS[platform];

  const screens = req.screens ?? [];
  if (screens.length === 0) {
    return { ok: false, error: "screens is required and must be a non-empty array" };
  }
  if (screens.length > SHOWCASE_MAX_SCREENS) {
    return { ok: false, error: `Too many screens: ${screens.length} (max ${SHOWCASE_MAX_SCREENS})` };
  }
  const coverCount = screens.filter((s) => s.cover === true).length;
  if (coverCount > 1) {
    return { ok: false, error: "Only one screen may have cover: true" };
  }

  // Rasterizing up to 5 screens (embed captures included) is seconds of
  // work — check reachability before spending it instead of discovering
  // we're offline only once the POST at the very end fails with a generic
  // "Failed to fetch". `isOffline()` is this repo's single source of truth
  // for that check (see apiBase.ts).
  if (isOffline()) {
    return {
      ok: false,
      error: "You're offline — publishing to the showcase needs a network connection.",
    };
  }

  const sceneState = useSceneStore.getState();
  const { nodesById, childrenById } = sceneState;
  const allNodes = sceneState.getNodes();
  const { calculateLayoutForFrame } = useLayoutStore.getState();

  // Pass 1: resolve nodes, source sizes and HTML. Screens are normalized into
  // the platform viewport for publication without mutating their scene nodes.
  const resolved: ResolvedScreen[] = [];

  for (const screen of screens) {
    const node = nodesById[screen.nodeId];
    if (!node) {
      return { ok: false, error: `Node not found: ${screen.nodeId}` };
    }

    const effectiveSize = getNodeEffectiveSize(allNodes, screen.nodeId, calculateLayoutForFrame);
    const size = effectiveSize ?? { width: node.width, height: node.height };

    let htmlContent: string;
    if (node.type === "embed") {
      htmlContent = (node as EmbedNode).htmlContent;
    } else {
      const fragment = convertDesignNodesToHtml(screen.nodeId, nodesById, childrenById, allNodes);
      htmlContent = wrapFragmentAsDocument(fragment, size.width, size.height);
    }

    if (!htmlContent || htmlContent.trim().length === 0) {
      return { ok: false, error: `Screen "${screen.title}" (${screen.nodeId}) has no content to publish` };
    }

    // INVARIANT: the HTML we POST must carry the same theme variables the
    // raster below is rendered with, or the gallery thumbnail (from the PNG)
    // and the lightbox (which iframes this stored HTML) can render two
    // different themes for the same screen. An embed is rasterized with
    // `captureEmbedCanvas`'s effective-ancestor-theme `:root` block appended
    // (see embedScreenshot.ts); a frame's PNG comes from Pixi under that same
    // effective ancestor theme, but `convertDesignNodesToHtml` above always
    // emits a light-theme block. Appending the effective theme's block here,
    // last, for BOTH node types fixes this — a later `<style>:root>` block
    // wins over an earlier one at equal specificity — and keeps this the one
    // place either path can silently regress out of sync again.
    const themeBlock = buildVariableStyleBlock(undefined, getEffectiveThemeForNode(screen.nodeId));
    if (themeBlock) {
      htmlContent += themeBlock;
    }

    const rasterHtmlContent = htmlContent;
    htmlContent += viewportNormalizationStyle(size, viewport);

    resolved.push({
      nodeId: screen.nodeId,
      title: screen.title,
      cover: screen.cover === true,
      sourceWidth: size.width,
      sourceHeight: size.height,
      htmlContent,
      rasterHtmlContent,
    });
  }

  // Pass 2: rasterize each screen at 2x.
  const { pixiRefs } = useCanvasRefStore.getState();
  const images: string[] = [];

  for (const screen of resolved) {
    const node = nodesById[screen.nodeId];
    let canvas: HTMLCanvasElement;
    try {
      if (node.type === "embed") {
        // No `nodeId` here — `screen.htmlContent` already carries the
        // effective-theme block appended above, so passing it would have
        // `captureEmbedCanvas` append a second, redundant (if harmless)
        // copy of the same block.
        const embedCanvas = await captureEmbedCanvas(
          {
            htmlContent: screen.rasterHtmlContent,
            width: screen.sourceWidth,
            height: screen.sourceHeight,
          },
          2,
        );
        if (!embedCanvas) {
          return {
            ok: false,
            error: `Screen "${screen.title}" (${screen.nodeId}) could not be rendered to an image (its HTML may be empty, or contain a cross-origin image served without CORS headers).`,
          };
        }
        canvas = normalizeCanvasToViewport(embedCanvas, viewport, 2);
      } else {
        if (!pixiRefs) {
          return { ok: false, error: "No canvas renderer available" };
        }
        const sourceCanvas = await renderNodeToCanvas(
          pixiRefs,
          screen.nodeId,
          { width: screen.sourceWidth, height: screen.sourceHeight },
          2,
        );
        canvas = normalizeCanvasToViewport(sourceCanvas, viewport, 2);
      }
    } catch (e) {
      return {
        ok: false,
        error: `Failed to rasterize screen "${screen.title}" (${screen.nodeId}): ${e instanceof Error ? e.message : "unknown error"}`,
      };
    }

    const expectedWidth = viewport.width * 2;
    const expectedHeight = viewport.height * 2;
    if (
      Math.abs(canvas.width - expectedWidth) > PIXEL_TOLERANCE ||
      Math.abs(canvas.height - expectedHeight) > PIXEL_TOLERANCE
    ) {
      return {
        ok: false,
        error: `Rasterized screen "${screen.title}" (${screen.nodeId}) is ${canvas.width}x${canvas.height}px, expected ${expectedWidth}x${expectedHeight}px`,
      };
    }

    let dataUrl: string;
    try {
      dataUrl = canvas.toDataURL("image/png");
    } catch (e) {
      // A canvas tainted by a cross-origin image served without CORS headers
      // throws SecurityError on readback (drawImage still painted it, but
      // pixels aren't extractable) — see captureEmbedScreenshot's comment.
      return {
        ok: false,
        error: `Could not read back pixels for screen "${screen.title}" (${screen.nodeId}): ${e instanceof Error ? e.message : "unknown error"}`,
      };
    }
    images.push(dataUrl);
  }

  const coverIndex = resolved.findIndex((s) => s.cover);

  const body = {
    theme,
    prompt: req.prompt,
    platform,
    // Required by the backend (same anonymous client id /api/chat sends,
    // via getUserId() — see src/lib/userId.ts). It's a modest gate, not
    // authentication: a request missing it, or shaped implausibly, gets a
    // 400. getUserId() always returns something usable (it creates and
    // persists an id on first call, with a per-process fallback when
    // localStorage throws), so this never needs its own error handling here.
    userId: getUserId(),
    ...(coverIndex >= 0 ? { coverIndex: coverIndex + 1 } : {}),
    screens: resolved.map((screen, i) => ({
      name: screen.title,
      htmlContent: screen.htmlContent,
      image: images[i],
      width: viewport.width,
      height: viewport.height,
    })),
  };

  let res: Response;
  try {
    res = await fetch(resolveApiUrl("/api/showcase/publish"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    return {
      ok: false,
      error: `Failed to reach the showcase: ${e instanceof Error ? e.message : "network error"}`,
    };
  }

  if (!res.ok) {
    let serverError: string | undefined;
    let runId: string | undefined;
    let publishedCount: number | undefined;
    try {
      const data = (await res.json()) as { error?: string; runId?: string; publishedCount?: number };
      serverError = data.error;
      runId = data.runId;
      publishedCount = data.publishedCount;
    } catch {
      // response body wasn't JSON — fall through to the status-only message
    }

    // A 503 means the server has no showcase storage or S3 configured —
    // the backend returns this status for that specific misconfiguration,
    // nothing else.
    if (res.status === 503) {
      return {
        ok: false,
        error: "Publishing is not available on this server (showcase storage isn't configured).",
      };
    }

    const base = serverError
      ? `Showcase publish failed (${res.status}): ${serverError}`
      : `Showcase publish failed (${res.status})`;
    // A 502 means publishScreens failed partway through — earlier screens in
    // this call may already be live as a truncated gallery card. Surface the
    // runId so it's actually actionable instead of losing it.
    const cleanup =
      runId !== undefined
        ? ` ${publishedCount ?? 0} screen(s) already published under runId ${runId} — clean up with \`npm run showcase:delete -- --app ${runId}\`.`
        : "";
    return { ok: false, error: base + cleanup };
  }

  // Never throw on the success path either: a 200 with a non-JSON body (a
  // proxy/CDN error page) or an abort mid-body-read must still come back as
  // `{ ok: false, error }`, matching this module's "never throws" contract.
  let data: { runId: string; platform: string; screens: { title: string; imageUrl: string }[] };
  try {
    const parsed = (await res.json()) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as { runId?: unknown }).runId !== "string" ||
      !Array.isArray((parsed as { screens?: unknown }).screens)
    ) {
      return { ok: false, error: "Showcase publish returned an unexpected response shape" };
    }
    data = parsed as typeof data;
  } catch (e) {
    return {
      ok: false,
      error: `Showcase publish succeeded but the response could not be read: ${e instanceof Error ? e.message : "invalid response"}`,
    };
  }

  toast.success(`Published "${theme}" to the showcase (${data.screens.length} screen${data.screens.length === 1 ? "" : "s"})`);

  return { ok: true, runId: data.runId, theme, screens: data.screens };
}

// ---------------------------------------------------------------------------
// Pure helpers for the panel's pre-flight UI (size validation, reading-order
// sort, title fallback). Kept side-effect-free and independently testable —
// see src/lib/__tests__/showcasePublish.test.ts.
// ---------------------------------------------------------------------------

export interface ScreenSizeCandidate {
  title: string;
  width: number;
  height: number;
}

export type PlatformInferenceResult =
  | { ok: true; platform: ShowcasePlatform }
  | { ok: false; error: string };

function matchesViewport(
  candidate: { width: number; height: number },
  viewport: { width: number; height: number },
): boolean {
  return (
    Math.abs(candidate.width - viewport.width) <= SIZE_TOLERANCE &&
    Math.abs(candidate.height - viewport.height) <= SIZE_TOLERANCE
  );
}

/**
 * Infer which showcase platform a set of screens belongs to by checking
 * whether every screen matches a single viewport (mobile or desktop). Used
 * by the panel to enable/disable the publish button before the network
 * round trip the agent-side size check does inside `publishScreensToShowcase`.
 */
export function inferPlatformForSizes(screens: ScreenSizeCandidate[]): PlatformInferenceResult {
  if (screens.length === 0) {
    return { ok: false, error: "No screens selected" };
  }

  const nearestPlatforms = screens.map((screen): ShowcasePlatform => {
    const distance = (platform: ShowcasePlatform) => {
      const viewport = SHOWCASE_VIEWPORTS[platform];
      return Math.hypot(
        Math.log(screen.width / viewport.width),
        Math.log(screen.height / viewport.height),
      );
    };
    return distance("mobile") <= distance("desktop") ? "mobile" : "desktop";
  });

  const platform = nearestPlatforms[0];
  if (nearestPlatforms.every((candidate) => candidate === platform)) {
    return { ok: true, platform };
  }

  const offenders = screens
    .filter((_, index) => nearestPlatforms[index] !== platform)
    .map((screen) => `"${screen.title}"`)
    .join(", ");

  return {
    ok: false,
    error: `Selected screens mix mobile and desktop layouts. Select screens for one platform at a time: ${offenders}`,
  };
}

// How close a selected node's own size has to be to *some* showcase viewport
// before the panel even offers the "Publish to Showcase" section — much
// looser than SIZE_TOLERANCE/inferPlatformForSizes above, which decide
// whether a screen actually qualifies to publish. This only decides whether
// showing a size error is useful feedback (a near-miss, e.g. 388x840) versus
// pure noise (a 120x40 button frame, nowhere near either viewport).
const PLAUSIBLE_SIZE_RATIO = 0.5;

/** Whether a node's size is close enough to a known showcase viewport that
 * the publish panel is worth showing at all (see PLAUSIBLE_SIZE_RATIO). */
export function isPlausibleShowcaseSize(size: { width: number; height: number }): boolean {
  return (Object.keys(SHOWCASE_VIEWPORTS) as ShowcasePlatform[]).some((platform) => {
    const vp = SHOWCASE_VIEWPORTS[platform];
    const widthRatio = size.width / vp.width;
    const heightRatio = size.height / vp.height;
    return (
      widthRatio >= PLAUSIBLE_SIZE_RATIO &&
      widthRatio <= 1 / PLAUSIBLE_SIZE_RATIO &&
      heightRatio >= PLAUSIBLE_SIZE_RATIO &&
      heightRatio <= 1 / PLAUSIBLE_SIZE_RATIO
    );
  });
}

export interface PositionedScreen {
  x: number;
  y: number;
}

// Two screens are "the same row" when their absolute Y differs by less than
// this — loose enough to absorb a few px of misalignment between
// nominally-aligned screens, tight enough not to merge two actual grid rows
// (which are typically a full screen height + gap apart, hundreds of px).
const ROW_BAND_TOLERANCE = 40;

/**
 * Selection order on the canvas isn't meaningful — group screens into row
 * "bands" by absolute Y (screens in one row rarely share Y to the pixel, so
 * this uses a tolerance rather than an exact match), then sort left-to-right
 * by X within each band, bands top-to-bottom. A naive `x` primary / `y`
 * tiebreak sort (the previous implementation) is column-major, not reading
 * order: a 3+2 grid of same-width screens shares X exactly per column, so it
 * would order col1row1, col1row2, col2row1, ... instead of row1's screens
 * left-to-right, then row2's.
 */
export function sortByReadingOrder<T extends PositionedScreen>(items: T[]): T[] {
  if (items.length === 0) return [];

  const byY = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const bands: T[][] = [];
  for (const item of byY) {
    const currentBand = bands[bands.length - 1];
    // Compare against the band's first (topmost) member rather than the most
    // recently added one, so a band's Y range can't drift beyond the
    // tolerance through a chain of pairwise-close-but-cumulatively-far items.
    if (currentBand && item.y - currentBand[0].y <= ROW_BAND_TOLERANCE) {
      currentBand.push(item);
    } else {
      bands.push([item]);
    }
  }

  return bands.flatMap((band) => [...band].sort((a, b) => a.x - b.x || a.y - b.y));
}

// Matches the same Figma-style "default name" shape the codegen layer treats
// as unnamed (src/lib/codegen/react.ts's DEFAULT_NAME_LABELS), for the two
// node types the showcase panel accepts.
const GENERIC_SCREEN_NAME_RE = /^(Frame|Embed)(\s+\d+)?$/i;

/** Whether a node's name is empty or still a generic default like "Frame 2". */
export function isGenericScreenName(name: string | undefined): boolean {
  const trimmed = name?.trim();
  return !trimmed || GENERIC_SCREEN_NAME_RE.test(trimmed);
}

/** A screen's publish title: its own name, or "Screen N" (1-based) when unnamed/generic. */
export function screenTitleFor(name: string | undefined, index: number): string {
  return isGenericScreenName(name) ? `Screen ${index + 1}` : (name as string).trim();
}

/**
 * Live effective size of a node (accounting for Yoga auto-layout/fit-content,
 * same as the rasterization pass above), for the panel's pre-flight check —
 * it needs to know sizes *before* the user hits publish, not just at
 * publish-time inside `publishScreensToShowcase`.
 */
export function getEffectiveScreenSize(nodeId: string): { width: number; height: number } | null {
  const sceneState = useSceneStore.getState();
  const node = sceneState.nodesById[nodeId];
  if (!node) return null;
  const allNodes = sceneState.getNodes();
  const { calculateLayoutForFrame } = useLayoutStore.getState();
  const effective = getNodeEffectiveSize(allNodes, nodeId, calculateLayoutForFrame);
  return effective ?? { width: node.width, height: node.height };
}
