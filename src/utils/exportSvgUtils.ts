import type { FlatSceneNode } from "@/types/scene";
import { convertDesignNodesToSvg } from "@/lib/designToSvg";

/**
 * Download an SVG string as a file (mirrors `downloadDataUrl` in
 * `exportUtils.ts`, but built from a Blob since we have raw text, not a data
 * URL from a canvas).
 */
function downloadSvgString(svgString: string, filename: string): void {
  const blob = new Blob([svgString], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    // Revoke after a tick so the download has a chance to start.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function safeSvgFilename(baseName: string): string {
  const sanitized = baseName.replace(/[^a-zA-Z0-9_-]/g, "_") || "canvas";
  return `${sanitized}.svg`;
}

/**
 * Serialize a scene node to SVG and trigger a file download.
 * Returns any warnings about content that couldn't be faithfully exported
 * (embeds, component instances, shaders, unsupported effects) so the caller
 * can surface them to the user.
 */
export function exportNodeToSvgFile(
  nodeId: string,
  nodeName: string | undefined,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
): { warnings: string[] } {
  const { svg, warnings } = convertDesignNodesToSvg(nodeId, nodesById, childrenById);
  if (svg) {
    downloadSvgString(svg, safeSvgFilename(nodeName || nodeId));
  }
  if (warnings.length > 0) {
    console.warn("SVG export warnings:", warnings);
  }
  return { warnings };
}
