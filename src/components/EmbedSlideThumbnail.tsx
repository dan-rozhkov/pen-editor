import { useEffect, useRef } from "react";
import type { EmbedNode } from "@/types/scene";
import {
  applyEmbedInheritedDefaults,
  mountHtmlWithBodyStyles,
} from "@/utils/embedHtmlUtils";

/** Live, inert HTML preview for a root embed shown in the Slides panel. */
export function EmbedSlideThumbnail({ node }: { node: EmbedNode }) {
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const shadow = viewport.shadowRoot ?? viewport.attachShadow({ mode: "open" });
    shadow.replaceChildren();

    const content = document.createElement("div");
    content.style.width = `${node.width}px`;
    content.style.height = `${node.height}px`;
    content.style.overflow = "hidden";
    content.style.transformOrigin = "top left";
    applyEmbedInheritedDefaults(content);
    mountHtmlWithBodyStyles(content, node.htmlContent, node.width, node.height);
    shadow.appendChild(content);

    const position = () => {
      const { width, height } = viewport.getBoundingClientRect();
      if (width <= 0 || height <= 0 || node.width <= 0 || node.height <= 0) return;
      const scale = Math.min(width / node.width, height / node.height);
      content.style.transform = `translate(${(width - node.width * scale) / 2}px, ${(height - node.height * scale) / 2}px) scale(${scale})`;
    };

    position();
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(position);
    observer?.observe(viewport);
    window.addEventListener("resize", position);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", position);
    };
  }, [node.height, node.htmlContent, node.width]);

  return (
    <div
      ref={viewportRef}
      data-testid={`embed-slide-thumbnail-${node.id}`}
      className="size-full overflow-hidden pointer-events-none"
    />
  );
}
