import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSceneStore } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useViewportStore } from "@/store/viewportStore";
import { useSelectionStore } from "@/store/selectionStore";
import { mountHtmlWithBodyStyles } from "@/utils/embedHtmlUtils";
import { buildVariableStyleBlock } from "@/utils/variableCssUtils";
import { getEffectiveThemeForNode } from "@/utils/nodeThemeUtils";
import { getNodeAbsolutePositionWithLayout } from "@/utils/nodeUtils";
import type { EmbedNode } from "@/types/scene";
import { embedScreenRect } from "./embedLayerGeometry";

/** One Shadow-DOM host for a single embed node, synced to the viewport. */
function EmbedHost({ nodeId }: { nodeId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const node = useSceneStore((s) => s.nodesById[nodeId]) as EmbedNode | undefined;
  const isActive = useSelectionStore((s) => s.activeEmbedId === nodeId);

  const htmlContent = node?.htmlContent;
  const width = node?.width;
  const height = node?.height;

  // Position/scale the host imperatively from the scene + viewport (no React
  // re-render). Geometry lives here — not in the inline style — so a React
  // re-render (e.g. on active toggle) never clobbers the imperative values.
  const position = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    const scene = useSceneStore.getState();
    const n = scene.nodesById[nodeId] as EmbedNode | undefined;
    if (!n) return;
    const calc = useLayoutStore.getState().calculateLayoutForFrame;
    const abs = getNodeAbsolutePositionWithLayout(scene.getNodes(), nodeId, calc);
    if (!abs) return;
    const { scale, x: panX, y: panY } = useViewportStore.getState();
    const dpr = window.devicePixelRatio || 1;
    const rect = embedScreenRect(abs.x, abs.y, n.width, n.height, scale, panX, panY, dpr);
    host.style.left = `${rect.left}px`;
    host.style.top = `${rect.top}px`;
    host.style.width = `${rect.width}px`;
    host.style.height = `${rect.height}px`;
    const content = contentRef.current;
    if (content) content.style.transform = `scale(${scale})`;
  }, [nodeId]);

  // Keep the host positioned as the scene, layout, or viewport changes.
  useEffect(() => {
    position();
    const unsubViewport = useViewportStore.subscribe(position);
    const unsubLayout = useLayoutStore.subscribe(position);
    const unsubScene = useSceneStore.subscribe(position);
    return () => { unsubViewport(); unsubLayout(); unsubScene(); };
  }, [position]);

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
    const themeBlock = buildVariableStyleBlock(undefined, getEffectiveThemeForNode(nodeId));
    const html = themeBlock ? htmlContent + themeBlock : htmlContent;
    mountHtmlWithBodyStyles(content, html, width, height);
    shadow.appendChild(content);
    contentRef.current = content;

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
  const embedIds = useMemo(
    () => Object.keys(nodesById).filter((id) => nodesById[id]?.type === "embed"),
    [nodesById],
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
