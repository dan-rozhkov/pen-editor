import type { ShaderConfig } from "@/types/scene";

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
