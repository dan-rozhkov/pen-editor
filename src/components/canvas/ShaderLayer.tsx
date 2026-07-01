import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSceneStore } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useViewportStore } from "@/store/viewportStore";
import { getNodeAbsolutePositionWithLayout } from "@/utils/nodeUtils";
import { SHADER_REGISTRY } from "@/lib/shaders/registry";
import { buildShaderProps } from "@/lib/shaders/buildShaderProps";
import { extractNodeImage } from "@/lib/shaders/nodeRaster";
import type { SceneNode } from "@/types/scene";
import { embedScreenRect } from "./embedLayerGeometry";

/** CSS clip for the shader host derived from the node shape. */
function clipFor(node: SceneNode): { borderRadius?: string; clipPath?: string } {
  if (node.type === "ellipse") return { borderRadius: "50%" };
  if (node.type === "path" && node.geometry) return { clipPath: `path('${node.geometry}')` };
  const r = (node as { cornerRadius?: number }).cornerRadius;
  return r ? { borderRadius: `${r}px` } : {};
}

/** One shader canvas host for a single node, synced to the viewport. */
function ShaderHost({ nodeId }: { nodeId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const node = useSceneStore((s) => s.nodesById[nodeId]) as SceneNode | undefined;
  const shader = node?.shader;
  const [image, setImage] = useState<string | undefined>(undefined);

  const position = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    const scene = useSceneStore.getState();
    const n = scene.nodesById[nodeId] as SceneNode | undefined;
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
  }, [nodeId]);

  useEffect(() => {
    position();
    const unsubViewport = useViewportStore.subscribe(position);
    const unsubLayout = useLayoutStore.subscribe(position);
    const unsubScene = useSceneStore.subscribe(position);
    return () => { unsubViewport(); unsubLayout(); unsubScene(); };
  }, [position]);

  // For image-filter shaders, rasterize the node and re-run on size change.
  const isImageShader = shader ? SHADER_REGISTRY[shader.kind].category === "image" : false;
  const width = node?.width;
  const height = node?.height;
  useEffect(() => {
    if (!isImageShader) { setImage(undefined); return; }
    let cancelled = false;
    // Defer so the node's Pixi container exists and has rendered.
    const t = setTimeout(() => {
      extractNodeImage(nodeId).then((img) => { if (!cancelled && img) setImage(img); });
    }, 50);
    return () => { cancelled = true; clearTimeout(t); };
  }, [nodeId, isImageShader, width, height]);

  if (!node || !shader) return null;
  const desc = SHADER_REGISTRY[shader.kind];
  const Component = desc.Component;
  const props = buildShaderProps(shader, image);
  const clip = clipFor(node);

  return (
    <div
      ref={hostRef}
      data-shader-id={nodeId}
      style={{ position: "absolute", overflow: "hidden", pointerEvents: "none", ...clip }}
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
  const shaderIds = useMemo(
    () =>
      Object.keys(nodesById).filter((id) => {
        const n = nodesById[id];
        return n?.shader != null && n.visible !== false && n.enabled !== false;
      }),
    [nodesById],
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
