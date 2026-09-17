import { useEffect, useRef } from "react";
import type { EmbedNode } from "@/types/scene";
import {
  applyEditorVariableProperties,
  applyEmbedInheritedDefaults,
  mountHtmlWithBodyStyles,
} from "@/utils/embedHtmlUtils";
import { collectVariableValues } from "@/utils/variableCssUtils";
import { getEffectiveThemeForNode } from "@/utils/nodeThemeUtils";

/** Live, inert HTML preview for a root embed shown in the Slides panel. */
export function EmbedSlideThumbnail({ node }: { node: EmbedNode }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const { width: embedWidth, height: embedHeight, htmlContent } = node;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const shadow = viewport.shadowRoot ?? viewport.attachShadow({ mode: "open" });
    shadow.replaceChildren();

    const content = document.createElement("div");
    content.style.width = `${embedWidth}px`;
    content.style.height = `${embedHeight}px`;
    content.style.overflow = "hidden";
    content.style.transformOrigin = "top left";
    applyEmbedInheritedDefaults(content);
    const mountResult = mountHtmlWithBodyStyles(content, htmlContent, embedWidth, embedHeight);
    // F5: without this, an element whose fill is bound to an editor
    // variable (`var(--brand)`) renders with nothing to resolve that custom
    // property against in this thumbnail's own shadow tree — the Slides
    // panel would show the fill as transparent even though the live canvas
    // (EmbedLayer.tsx, which applies the same call) shows it resolved.
    applyEditorVariableProperties(
      content,
      mountResult.root,
      collectVariableValues(undefined, getEffectiveThemeForNode(node.id)),
    );
    shadow.appendChild(content);

    const syncPreviewLayout = () => {
      const { width, height } = viewport.getBoundingClientRect();
      if (width <= 0 || height <= 0 || embedWidth <= 0 || embedHeight <= 0) return;

      const scale = Math.min(width / embedWidth, height / embedHeight);
      const offsetX = (width - embedWidth * scale) / 2;
      const offsetY = (height - embedHeight * scale) / 2;
      content.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
    };

    syncPreviewLayout();
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(syncPreviewLayout);
    observer?.observe(viewport);
    window.addEventListener("resize", syncPreviewLayout);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", syncPreviewLayout);
    };
  }, [embedHeight, embedWidth, htmlContent, node.id]);

  return (
    <div
      ref={viewportRef}
      data-testid={`embed-slide-thumbnail-${node.id}`}
      className="size-full overflow-hidden pointer-events-none"
    />
  );
}
