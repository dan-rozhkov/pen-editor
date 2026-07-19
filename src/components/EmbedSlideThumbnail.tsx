import { useEffect, useRef } from "react";
import type { EmbedNode } from "@/types/scene";
import {
  applyEmbedInheritedDefaults,
  mountHtmlWithBodyStyles,
} from "@/utils/embedHtmlUtils";

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
    mountHtmlWithBodyStyles(content, htmlContent, embedWidth, embedHeight);
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
  }, [embedHeight, embedWidth, htmlContent]);

  return (
    <div
      ref={viewportRef}
      data-testid={`embed-slide-thumbnail-${node.id}`}
      className="size-full overflow-hidden pointer-events-none"
    />
  );
}
