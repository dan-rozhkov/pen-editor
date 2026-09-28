import { useCallback, useEffect, useRef } from "react";
import {
  useAiPendingScreenStore,
  pendingHtmlKey,
  type PendingScreenGeometry,
} from "@/store/aiPendingScreenStore";
import { useViewportStore } from "@/store/viewportStore";
import { useVariableStore } from "@/store/variableStore";
import { useThemeStore } from "@/store/themeStore";
import { PLACEHOLDER_COLOR_CSS as ACCENT } from "@/lib/streamingTools/pendingScreenColor";
import { repairPartialHtml } from "@/lib/streamingTools/partialHtml";
import { morphChildren } from "@/lib/streamingTools/morphDom";
import { measureFrontier } from "@/lib/streamingTools/measureFrontier";
import {
  applyEditorVariableProperties,
  applyEmbedInheritedDefaults,
  mountHtmlWithBodyStyles,
} from "@/utils/embedHtmlUtils";
import { collectVariableValues } from "@/utils/variableCssUtils";
import { embedScreenRect } from "./embedLayerGeometry";

/**
 * Live preview of a `batch_design` screen while its `htmlContent` is still
 * streaming: the partial markup is mounted inside the dashed placeholder's box
 * so the screen materializes top-to-bottom as the model types it. Updates MORPH
 * the live shadow tree toward a freshly built one (`morphDom.ts`) instead of
 * remounting, so unchanged nodes (images, iframes) never reload; only the
 * newly inserted subtrees get a Web Animations reveal. The "writing head" is a
 * sibling of the shadow host in the light DOM, out of reach of design CSS.
 * When the real embed node lands (same x/y/width/height) the draft disappears and the real
 * `EmbedHost` takes over in place.
 *
 * Not a scene node — nothing here enters history, the `.pen` or selection. The
 * html is untrusted, so it goes through the same mount pipeline as `EmbedHost`
 * (sanitization included). Spec:
 * `docs/superpowers/specs/2026-09-28-streaming-embed-preview-design.md`.
 */

/** Trailing throttle between updates; a full build+morph per streamed token
 * would re-parse tens of KB of markup dozens of times a second. */
const UPDATE_THROTTLE_MS = 120;
const REVEAL_MS = 420;
const REVEAL_EASING = "cubic-bezier(.2,.7,.2,1)";
const HEAD_SHIMMER_MS = 1100;

// Elements that never lay out; not worth a reveal.
const NON_VISUAL = new Set(["STYLE", "SCRIPT", "LINK", "META", "TITLE", "HEAD", "TEMPLATE", "BODY"]);

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    return false;
  }
}

/** Fade/slide/unblur a newly inserted subtree. Web Animations, so there is no
 * attribute, stylesheet rule or inline delay: the design's own CSS animations
 * are untouched and design CSS cannot cancel this one. The implicit `to`
 * keyframe is the element's own computed state. */
function reveal(el: Element): void {
  if (NON_VISUAL.has(el.tagName) || typeof el.animate !== "function") return;
  try {
    el.animate(
      [{ opacity: 0, transform: "translateY(6px)", filter: "blur(4px)" }, {}],
      { duration: REVEAL_MS, easing: REVEAL_EASING },
    );
  } catch {
    // best-effort cosmetics
  }
}

/** Same resolution as `EmbedHost` for a root node (no ancestors, so no
 * `themeOverride`): the global active theme. */
function previewVariableValues() {
  return collectVariableValues(undefined, useThemeStore.getState().activeTheme);
}

/** Build the screen's content off-DOM through the same pipeline as `EmbedHost`. */
function buildContent(raw: string, w: number, h: number) {
  const content = document.createElement("div");
  content.style.transformOrigin = "top left";
  content.style.width = `${w}px`;
  content.style.height = `${h}px`;
  content.style.overflow = "hidden";
  applyEmbedInheritedDefaults(content);
  const mountResult = mountHtmlWithBodyStyles(content, repairPartialHtml(raw), w, h);
  applyEditorVariableProperties(content, mountResult.root, previewVariableValues());
  return { content, root: mountResult.root };
}

function StreamingPreviewHost({
  draftKey,
  screen,
}: {
  draftKey: string;
  screen: PendingScreenGeometry;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const shadowHostRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const headLineRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  // The element the mount applied custom properties to (a nested synthetic
  // `<body>` for body-targeted html) — see EmbedHost's `mountRootRef`.
  const mountRootRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const contentBottomRef = useRef(0);
  // What the shadow DOM currently shows; skips no-op updates.
  const mountedRef = useRef<{ html: string; w: number; h: number } | null>(null);

  const { x, y, width, height, index } = screen;
  const htmlKey = pendingHtmlKey(draftKey, index);
  const sizeRef = useRef({ width, height });
  useEffect(() => {
    sizeRef.current = { width, height };
  }, [width, height]);

  const syncScale = useCallback((scale: number) => {
    const t = `scale(${scale})`;
    if (contentRef.current) contentRef.current.style.transform = t;
    if (headRef.current) headRef.current.style.transform = t;
    const line = headLineRef.current;
    if (line) {
      line.style.top = `${contentBottomRef.current}px`;
      // Keep the writing head ~2 screen px thick at any zoom.
      line.style.height = `${2 / scale}px`;
    }
  }, []);

  const position = useCallback(() => {
    const outer = outerRef.current;
    if (!outer) return;
    const { scale, x: panX, y: panY } = useViewportStore.getState();
    const dpr = window.devicePixelRatio || 1;
    const r = embedScreenRect(x, y, width, height, scale, panX, panY, dpr);
    outer.style.left = `${r.left}px`;
    outer.style.top = `${r.top}px`;
    outer.style.width = `${r.width}px`;
    outer.style.height = `${r.height}px`;
    syncScale(scale);
  }, [x, y, width, height, syncScale]);

  useEffect(() => {
    position();
    return useViewportStore.subscribe(position);
  }, [position]);

  // Writing-head shimmer: WAAPI, so no stylesheet is needed in the light DOM.
  useEffect(() => {
    const line = headLineRef.current;
    if (!line) return;
    if (prefersReducedMotion() || typeof line.animate !== "function") {
      line.style.background = ACCENT;
      line.style.opacity = "0.6";
      return;
    }
    const anim = line.animate(
      [{ backgroundPosition: "-40% 0" }, { backgroundPosition: "140% 0" }],
      { duration: HEAD_SHIMMER_MS, iterations: Infinity, easing: "linear" },
    );
    return () => {
      // Cancelling rejects `finished` (happy-dom reports it as unhandled).
      anim.finished?.catch(() => {});
      anim.cancel();
    };
  }, []);

  const update = useCallback(() => {
    timerRef.current = null;
    const shadowHost = shadowHostRef.current;
    if (!shadowHost) return;
    const raw = useAiPendingScreenStore.getState().html[htmlKey] ?? "";
    if (raw === "") return;
    const { width: w, height: h } = sizeRef.current;
    const last = mountedRef.current;
    if (last && last.html === raw && last.w === w && last.h === h) return;
    mountedRef.current = { html: raw, w, h };
    const shadow = shadowHost.shadowRoot ?? shadowHost.attachShadow({ mode: "open" });

    const next = buildContent(raw, w, h);
    let revealed: Element[];
    let liveContent = contentRef.current;
    if (!liveContent || liveContent.parentNode !== shadow) {
      shadow.replaceChildren(next.content);
      liveContent = next.content;
      contentRef.current = liveContent;
      mountRootRef.current = next.root;
      revealed = Array.from(next.root.children);
    } else {
      // The content box's own inline style carries size and, for non-body
      // html, the `:root` custom properties the mount copies onto it (`:root`
      // matches nothing inside a shadow root). `morphChildren` never touches
      // the box itself, so take the fresh build's style wholesale; the scale
      // transform is re-applied by `position()` below.
      liveContent.style.cssText = next.content.style.cssText;
      revealed = morphChildren(liveContent, next.content);
      // The synthetic <body> wrapper (body-targeted html) is a direct child of
      // the content box; if it was morphed the live one survives, if replaced
      // the new one now lives there. Either way find it in the live tree.
      const liveRoot =
        next.root === next.content
          ? liveContent
          : (Array.from(liveContent.children).find((c) => c.tagName === "BODY") as
              | HTMLElement
              | undefined) ?? liveContent;
      mountRootRef.current = liveRoot;
      applyEditorVariableProperties(liveContent, liveRoot, previewVariableValues());
    }

    // Layout reads first, then cosmetic writes.
    const root = mountRootRef.current ?? liveContent;
    const scale = useViewportStore.getState().scale || 1;
    const elements = Array.from(root.querySelectorAll<HTMLElement>("*")).filter(
      (el) => !NON_VISUAL.has(el.tagName),
    );
    const frontier =
      measureFrontier(elements, liveContent.getBoundingClientRect().top, root) / scale;
    contentBottomRef.current = Math.min(Math.max(frontier, 0), h);
    if (!prefersReducedMotion()) revealed.forEach(reveal);
    position();
  }, [htmlKey, position]);

  useEffect(() => {
    // First update immediately; later ones on a trailing throttle.
    update();
    return useAiPendingScreenStore.subscribe((state, prev) => {
      if (state.html[htmlKey] === prev.html[htmlKey]) return;
      if (timerRef.current === null) timerRef.current = window.setTimeout(update, UPDATE_THROTTLE_MS);
    });
  }, [htmlKey, update]);

  useEffect(() => {
    // Variable edits while a screen streams: reapply without rebuilding.
    return useVariableStore.subscribe(() => {
      const content = contentRef.current;
      const root = mountRootRef.current;
      if (!content || !root) return;
      applyEditorVariableProperties(content, root, previewVariableValues());
    });
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    },
    [],
  );

  return (
    <div
      ref={outerRef}
      data-streaming-embed-preview
      style={{ position: "absolute", overflow: "hidden", pointerEvents: "none" }}
    >
      {/* Design content only; nothing of ours lives in here. */}
      <div
        ref={shadowHostRef}
        data-streaming-embed-shadow
        style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%" }}
      />
      {/* Writing head: a light-DOM sibling so design CSS cannot restyle it. */}
      <div
        ref={headRef}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width,
          transformOrigin: "top left",
          pointerEvents: "none",
        }}
      >
        <div
          ref={headLineRef}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            background: `linear-gradient(90deg,transparent,${ACCENT},transparent)`,
            backgroundSize: "40% 100%",
            backgroundRepeat: "no-repeat",
          }}
        />
      </div>
    </div>
  );
}

/** Renders one live-preview host per staged pending screen that has html. */
export function StreamingEmbedPreviewLayer() {
  const drafts = useAiPendingScreenStore((s) => s.drafts);
  // Primitive selector: re-renders only when the SET of screens with html
  // changes, not on every streamed token.
  const withHtml = useAiPendingScreenStore((s) => Object.keys(s.html).join("\n"));
  const present = new Set(withHtml === "" ? [] : withHtml.split("\n"));
  return (
    <>
      {Object.entries(drafts).flatMap(([draftKey, draft]) =>
        draft.screens
          .filter((screen) => present.has(pendingHtmlKey(draftKey, screen.index)))
          .map((screen) => (
            <StreamingPreviewHost
              key={pendingHtmlKey(draftKey, screen.index)}
              draftKey={draftKey}
              screen={screen}
            />
          )),
      )}
    </>
  );
}
