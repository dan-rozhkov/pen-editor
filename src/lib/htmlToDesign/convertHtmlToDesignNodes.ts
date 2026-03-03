import type { SceneNode, FrameNode } from "@/types/scene";
import { generateId } from "@/types/scene";
import { mountHtmlWithBodyStyles } from "@/utils/embedHtmlUtils";
import { materializePseudoElements } from "@/utils/pseudoElementMaterializer";
import { scopeStyleTagsToRoot } from "./cssScoping";
import { parseColorWithOpacity } from "./colorParsing";
import { applyBaseProps } from "./styleApplication";
import { inferAutoLayout } from "./layoutInference";
import { convertNode } from "./convertElement";

/**
 * Convert HTML content into a native design node tree.
 *
 * Uses the same DOM-based pipeline as htmlTextureHelpers.ts:
 * insert HTML into a hidden DOM element, let the browser compute layout,
 * then walk the tree reading getComputedStyle + getBoundingClientRect
 * to produce SceneNodes.
 */
export async function convertHtmlToDesignNodes(
  htmlContent: string,
  width: number,
  height: number,
): Promise<FrameNode> {
  // 1. Create hidden container at embed dimensions
  const container = document.createElement("div");
  container.style.cssText = `
    position: fixed;
    left: -99999px;
    top: -99999px;
    width: ${width}px;
    height: ${height}px;
    overflow: hidden;
    pointer-events: none;
  `;
  // Sanitize: strip event handler attributes and script tags to prevent execution
  const sanitized = htmlContent
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\bon\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, "");
  const { root: conversionRoot, wrappedBody } = mountHtmlWithBodyStyles(
    container,
    sanitized,
    width,
    height,
  );
  // Scope embed CSS before mounting into document.body to prevent global UI flicker.
  const scopeId = `convert-scope-${generateId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  conversionRoot.setAttribute("data-convert-scope", scopeId);
  scopeStyleTagsToRoot(container, `[data-convert-scope="${scopeId}"]`);
  document.body.appendChild(container);

  // Wait for fonts and images to load, then one frame for reflow
  await document.fonts.ready;
  await Promise.all(
    Array.from(conversionRoot.querySelectorAll("img")).map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((res) => {
            img.onload = img.onerror = () => res();
          }),
    ),
  );
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  materializePseudoElements(conversionRoot);

  try {
    const containerRect = conversionRoot.getBoundingClientRect();
    // Per-call map correlating DOM elements to their converted SceneNodes
    const elementNodeMap = new Map<Element, SceneNode>();

    // Convert the container's children into scene nodes
    const children: SceneNode[] = [];
    for (const child of conversionRoot.childNodes) {
      const node = convertNode(child, containerRect, elementNodeMap);
      if (node) children.push(node);
    }

    // Create root frame matching embed dimensions
    const rootFrame: FrameNode = {
      id: generateId(),
      type: "frame",
      name: "Converted HTML",
      x: 0,
      y: 0,
      width,
      height,
      clip: true,
      children,
    };

    // Preserve root-level visual styles (e.g. `body { background: ... }`).
    const conversionRootStyle = window.getComputedStyle(conversionRoot);
    applyBaseProps(rootFrame, conversionRootStyle);

    // If there's a single top-level element, try to infer its layout
    if (!wrappedBody && conversionRoot.children.length === 1) {
      const topStyle = window.getComputedStyle(conversionRoot.children[0]);
      const layout = inferAutoLayout(topStyle, conversionRoot.children[0]);
      if (layout) rootFrame.layout = layout.layout;
      const bg = parseColorWithOpacity(topStyle.backgroundColor);
      if (bg) {
        rootFrame.fill = bg.color;
        if (bg.opacity !== undefined) rootFrame.fillOpacity = bg.opacity;
      }
    }

    return rootFrame;
  } finally {
    document.body.removeChild(container);
  }
}
