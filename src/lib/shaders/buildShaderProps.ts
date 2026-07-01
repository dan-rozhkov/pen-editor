import type { ShaderConfig } from "@/types/scene";
import { SHADER_REGISTRY } from "./registry";

/**
 * Merge a shader config into the props passed to the library component:
 * preset params (if any) < schema defaults filled for missing keys < user overrides.
 * For image-filter shaders, `image` (a data URL) is injected when provided.
 */
export function buildShaderProps(cfg: ShaderConfig, image?: string): Record<string, unknown> {
  const desc = SHADER_REGISTRY[cfg.kind];
  const preset = desc.presets.find((p) => p.name === cfg.preset);
  const props: Record<string, unknown> = { ...(preset?.params ?? {}) };
  // Ensure every curated param has a value so controls are always populated.
  for (const p of desc.params) {
    if (props[p.key] === undefined) props[p.key] = p.default;
  }
  Object.assign(props, cfg.params);
  if (desc.category === "image" && image) props.image = image;
  return props;
}
