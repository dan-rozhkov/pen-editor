import type { SceneNode, ShaderConfig } from "@/types/scene";
import { getFills } from "@/utils/fillUtils";

/** Merge a single param override into a shader config (immutably). */
export function setShaderParam(
  shader: ShaderConfig,
  key: string,
  value: number | string | string[],
): ShaderConfig {
  return { ...shader, params: { ...shader.params, [key]: value } };
}

/** Replace one entry of a color-array param (immutably). */
export function setShaderColorAt(
  shader: ShaderConfig,
  key: string,
  index: number,
  value: string,
  current: string[],
): ShaderConfig {
  const next = [...current];
  next[index] = value;
  return setShaderParam(shader, key, next);
}

/** Node types where a shader overlay makes visual sense. */
export const SHADER_SUPPORTED_TYPES = new Set(["rect", "frame", "ellipse", "text", "path"]);

/**
 * Whether a node has content that an image-filter shader can rasterize and
 * distort. Image filters read the node's rendered pixels, so a bare shape with
 * no fill (e.g. the rect the "Shader" tool creates) would feed them a
 * transparent image and render blank — those shaders are hidden for such nodes.
 */
export function nodeHasRasterContent(node: SceneNode): boolean {
  if (node.type === "text" || node.type === "frame") return true;
  return getFills(node).length > 0;
}
