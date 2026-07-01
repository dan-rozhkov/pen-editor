import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSceneStore } from "@/store/sceneStore";
import { SHADER_REGISTRY } from "@/lib/shaders/registry";
import { buildShaderProps } from "@/lib/shaders/buildShaderProps";
import { extractNodeImage } from "@/lib/shaders/nodeRaster";
import type { SceneNode } from "@/types/scene";
import { useOverlayHostRect } from "./useOverlayHostRect";

/**
 * Whether any ancestor frame/group hides this node. The Pixi tree hides a node
 * transitively when a parent container's `visible` is false, but this flat DOM
 * overlay must walk the hierarchy itself or the shader canvas leaks over a
 * hidden layer.
 */
function isHiddenByAncestor(
  nodeId: string,
  nodesById: Record<string, { visible?: boolean; enabled?: boolean } | undefined>,
  parentById: Record<string, string | null>,
): boolean {
  let cur = parentById[nodeId] ?? null;
  while (cur) {
    const parent = nodesById[cur];
    if (parent && (parent.visible === false || parent.enabled === false)) return true;
    cur = parentById[cur] ?? null;
  }
  return false;
}

/**
 * Apply the node's shape as a CSS clip on the host, scaled to the current zoom
 * so it stays aligned (the host is sized in screen px). Ellipse → circle,
 * rounded rect → scaled border-radius, everything else → no clip (fills the
 * bounding box). Path geometry is intentionally NOT used as a `clip-path:
 * path()` — it is in unscaled local units and would be raw-interpolated, so it
 * both misaligns at zoom and risks malformed CSS.
 */
function applyClip(host: HTMLDivElement, node: SceneNode, scale: number): void {
  host.style.clipPath = "";
  if (node.type === "ellipse") {
    host.style.borderRadius = "50%";
    return;
  }
  const r = (node as { cornerRadius?: number }).cornerRadius;
  host.style.borderRadius = r ? `${r * scale}px` : "";
}

/** One shader canvas host for a single node, synced to the viewport. */
function ShaderHost({ nodeId }: { nodeId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const node = useSceneStore((s) => s.nodesById[nodeId]) as SceneNode | undefined;
  const shader = node?.shader;
  const [image, setImage] = useState<string | undefined>(undefined);

  const onSync = useCallback(
    (scale: number) => {
      const host = hostRef.current;
      if (host && node) applyClip(host, node, scale);
    },
    [node],
  );
  useOverlayHostRect(hostRef, nodeId, onSync);

  // Look up the descriptor defensively: a .pen file may carry an unknown
  // shader.kind (renamed/older/hand-edited) — render nothing rather than crash.
  const desc = shader ? SHADER_REGISTRY[shader.kind] : undefined;

  // For image-filter shaders, rasterize the node and re-run on size change.
  const isImageShader = desc?.category === "image";
  const width = node?.width;
  const height = node?.height;
  useEffect(() => {
    if (!isImageShader) return;
    let cancelled = false;
    // Defer so the node's Pixi container exists and has rendered.
    const t = setTimeout(() => {
      extractNodeImage(nodeId).then((img) => { if (!cancelled && img) setImage(img); });
    }, 50);
    return () => { cancelled = true; clearTimeout(t); };
  }, [nodeId, isImageShader, width, height]);

  if (!node || !shader || !desc) return null;
  const Component = desc.Component;
  const props = buildShaderProps(shader, isImageShader ? image : undefined);

  return (
    <div
      ref={hostRef}
      data-shader-id={nodeId}
      style={{ position: "absolute", overflow: "hidden", pointerEvents: "none" }}
    >
      <Component {...props} width="100%" height="100%" style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

/**
 * DOM overlay that renders every shader-bearing node as a live WebGL canvas above
 * the Pixi canvas. Transparent to pointer events so canvas selection/drag still
 * hit the underlying Pixi node (mirrors EmbedLayer). Sits just below the embed
 * layer (zIndex 10) so embeds remain on top.
 */
export function ShaderLayer() {
  const nodesById = useSceneStore((s) => s.nodesById);
  const parentById = useSceneStore((s) => s.parentById);
  const shaderIds = useMemo(
    () =>
      Object.keys(nodesById).filter((id) => {
        const n = nodesById[id];
        return (
          n?.shader != null &&
          n.visible !== false &&
          n.enabled !== false &&
          !isHiddenByAncestor(id, nodesById, parentById)
        );
      }),
    [nodesById, parentById],
  );

  return (
    <div
      data-shader-layer
      style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 9 }}
    >
      {shaderIds.map((id) => (
        <ShaderHost key={id} nodeId={id} />
      ))}
    </div>
  );
}
