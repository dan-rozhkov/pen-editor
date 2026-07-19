import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useRenderModeStore } from "@/store/renderModeStore";
import {
  applyEmbedInheritedDefaults,
  mountHtmlWithBodyStyles,
} from "@/utils/embedHtmlUtils";
import { ensureExternalFontStylesLoaded } from "@/pixi/renderers/htmlTexture/fontLoading";
import { buildVariableStyleBlock } from "@/utils/variableCssUtils";
import { getEffectiveThemeForNode } from "@/utils/nodeThemeUtils";
import type { EmbedNode } from "@/types/scene";
import { useOverlayHostRect } from "./useOverlayHostRect";

/** One Shadow-DOM host for a single embed node, synced to the viewport. */
function EmbedHost({ nodeId }: { nodeId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const node = useSceneStore((s) => s.nodesById[nodeId]) as EmbedNode | undefined;
  const isActive = useSelectionStore((s) => s.activeEmbedId === nodeId);

  const htmlContent = node?.htmlContent;
  const width = node?.width;
  const height = node?.height;

  // Scale the inner content to match the viewport zoom. The outer host rect and
  // the store subscriptions are handled by the shared overlay hook; this callback
  // is the embed-specific extra. (Geometry stays imperative so a React re-render —
  // e.g. on active toggle — never clobbers it.)
  const syncContentScale = useCallback((scale: number) => {
    const content = contentRef.current;
    if (content) content.style.transform = `scale(${scale})`;
  }, []);

  const position = useOverlayHostRect(hostRef, nodeId, syncContentScale);

  // (Re)mount embed content into the shadow root on html/size/theme change.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || htmlContent == null || width == null || height == null) return;
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    shadow.replaceChildren();

    const content = document.createElement("div");
    content.style.transformOrigin = "top left";
    content.style.width = `${width}px`;
    content.style.height = `${height}px`;
    content.style.overflow = "auto";
    applyEmbedInheritedDefaults(content);
    const themeBlock = buildVariableStyleBlock(undefined, getEffectiveThemeForNode(nodeId));
    const html = themeBlock ? htmlContent + themeBlock : htmlContent;
    mountHtmlWithBodyStyles(content, html, width, height);
    shadow.appendChild(content);
    contentRef.current = content;

    // Hoist allowlisted external font stylesheets (Google Fonts / Phosphor icon
    // fonts) to document level. Their class rules already apply inside the
    // shadow tree, but Chrome only registers `@font-face` fonts from
    // document-level styles — without this, icon/text web fonts render as tofu.
    void ensureExternalFontStylesLoaded(htmlContent);

    // Position now that content exists (applies the current scale transform).
    position();

    return () => { contentRef.current = null; };
  }, [position, nodeId, htmlContent, width, height]);

  if (!node) return null;

  return (
    <div
      ref={hostRef}
      data-embed-id={nodeId}
      style={{
        position: "absolute",
        overflow: "hidden",
        pointerEvents: isActive ? "auto" : "none",
      }}
    />
  );
}

/**
 * DOM overlay that renders every embed node as live browser DOM above the Pixi
 * canvas. Always on top; transparent to pointer events except for the active
 * (double-click-entered) embed.
 */
export function EmbedLayer() {
  const nodesById = useSceneStore((s) => s.nodesById);
  // Outline mode renders every embed as a plain bbox stroke in Pixi
  // (embedRenderer.ts) instead — the live HTML content has no wireframe
  // form of its own, so it's hidden entirely rather than shown on top of a
  // wireframe scene.
  const isOutline = useRenderModeStore((s) => s.renderMode === "outline");
  const embedIds = useMemo(
    () =>
      isOutline
        ? []
        : Object.keys(nodesById).filter((id) => {
            const n = nodesById[id];
            // Render only visible, enabled embeds — mirrors the Pixi
            // visibility rule (renderers/index.ts) so hiding a layer hides
            // its DOM too.
            return n?.type === "embed" && n.visible !== false && n.enabled !== false;
          }),
    [nodesById, isOutline],
  );

  return (
    <div
      data-embed-layer
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
        zIndex: 10,
      }}
    >
      {embedIds.map((id) => (
        <EmbedHost key={id} nodeId={id} />
      ))}
    </div>
  );
}
