import type React from "react";
import {
  MeshGradient, meshGradientPresets,
  Waves, wavesPresets,
  Warp, warpPresets,
  Spiral, spiralPresets,
  Metaballs, metaballsPresets,
  GodRays, godRaysPresets,
  Voronoi, voronoiPresets,
  Dithering, ditheringPresets,
  Water, waterPresets,
  FlutedGlass, flutedGlassPresets,
  HalftoneDots, halftoneDotsPresets,
  ImageDithering, imageDitheringPresets,
} from "@paper-design/shaders-react";
import type { ShaderKind, ShaderConfig } from "@/types/scene";

export interface ParamSchema {
  key: string;
  type: "color" | "colors" | "number" | "select";
  label: string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  default: number | string | string[];
}

export interface ShaderDescriptor {
  kind: ShaderKind;
  label: string;
  category: "fill" | "image";
  Component: React.ComponentType<Record<string, unknown>>;
  presets: { name: string; params: Record<string, unknown> }[];
  params: ParamSchema[];
}

// The library exports presets as `{ name, params }`; normalize to our shape.
type LibPreset = { name: string; params: Record<string, unknown> };
const presets = (arr: readonly unknown[]): { name: string; params: Record<string, unknown> }[] =>
  (arr as LibPreset[]).map((p) => ({ name: p.name, params: p.params ?? {} }));

export const SHADER_REGISTRY: Record<ShaderKind, ShaderDescriptor> = {
  meshGradient: {
    kind: "meshGradient", label: "Mesh Gradient", category: "fill",
    Component: MeshGradient as React.ComponentType<Record<string, unknown>>,
    presets: presets(meshGradientPresets),
    params: [
      { key: "colors", type: "colors", label: "Colors", default: ["#e0eaff", "#241d9a", "#f75092", "#9f50d3"] },
      { key: "speed", type: "number", label: "Speed", min: 0, max: 3, step: 0.05, default: 1 },
      { key: "distortion", type: "number", label: "Distortion", min: 0, max: 1, step: 0.01, default: 0.8 },
      { key: "swirl", type: "number", label: "Swirl", min: 0, max: 1, step: 0.01, default: 0.1 },
    ],
  },
  waves: {
    kind: "waves", label: "Waves", category: "fill",
    Component: Waves as React.ComponentType<Record<string, unknown>>,
    presets: presets(wavesPresets),
    params: [
      { key: "colorFront", type: "color", label: "Front", default: "#1a1a1a" },
      { key: "colorBack", type: "color", label: "Back", default: "#ffffff" },
      { key: "frequency", type: "number", label: "Frequency", min: 0, max: 2, step: 0.01, default: 0.4 },
      { key: "amplitude", type: "number", label: "Amplitude", min: 0, max: 1, step: 0.01, default: 0.3 },
      { key: "softness", type: "number", label: "Softness", min: 0, max: 1, step: 0.01, default: 0 },
      { key: "scale", type: "number", label: "Scale", min: 0.1, max: 3, step: 0.05, default: 1 },
    ],
  },
  warp: {
    kind: "warp", label: "Warp", category: "fill",
    Component: Warp as React.ComponentType<Record<string, unknown>>,
    presets: presets(warpPresets),
    params: [
      { key: "colors", type: "colors", label: "Colors", default: ["#5100ff", "#00c2ff", "#ffffff"] },
      { key: "speed", type: "number", label: "Speed", min: 0, max: 3, step: 0.05, default: 1 },
      { key: "rotation", type: "number", label: "Rotation", min: 0, max: 360, step: 1, default: 0 },
      { key: "scale", type: "number", label: "Scale", min: 0.1, max: 3, step: 0.05, default: 1 },
      { key: "distortion", type: "number", label: "Distortion", min: 0, max: 1, step: 0.01, default: 0.25 },
      { key: "swirl", type: "number", label: "Swirl", min: 0, max: 1, step: 0.01, default: 0.9 },
      { key: "softness", type: "number", label: "Softness", min: 0, max: 1, step: 0.01, default: 1 },
    ],
  },
  spiral: {
    kind: "spiral", label: "Spiral", category: "fill",
    Component: Spiral as React.ComponentType<Record<string, unknown>>,
    presets: presets(spiralPresets),
    params: [
      { key: "colorFront", type: "color", label: "Front", default: "#ffffff" },
      { key: "colorBack", type: "color", label: "Back", default: "#000000" },
      { key: "density", type: "number", label: "Density", min: 0, max: 1, step: 0.01, default: 1 },
      { key: "distortion", type: "number", label: "Distortion", min: 0, max: 1, step: 0.01, default: 0 },
      { key: "speed", type: "number", label: "Speed", min: 0, max: 3, step: 0.05, default: 1 },
      { key: "scale", type: "number", label: "Scale", min: 0.1, max: 3, step: 0.05, default: 1 },
    ],
  },
  metaballs: {
    kind: "metaballs", label: "Metaballs", category: "fill",
    Component: Metaballs as React.ComponentType<Record<string, unknown>>,
    presets: presets(metaballsPresets),
    params: [
      { key: "colors", type: "colors", label: "Colors", default: ["#ff0080", "#00c2ff", "#ffe600"] },
      { key: "colorBack", type: "color", label: "Back", default: "#000000" },
      { key: "speed", type: "number", label: "Speed", min: 0, max: 3, step: 0.05, default: 1 },
      { key: "scale", type: "number", label: "Scale", min: 0.1, max: 3, step: 0.05, default: 1 },
    ],
  },
  godRays: {
    kind: "godRays", label: "God Rays", category: "fill",
    Component: GodRays as React.ComponentType<Record<string, unknown>>,
    presets: presets(godRaysPresets),
    params: [
      { key: "colors", type: "colors", label: "Colors", default: ["#ffd600", "#ff9500"] },
      { key: "colorBack", type: "color", label: "Back", default: "#000010" },
      { key: "speed", type: "number", label: "Speed", min: 0, max: 3, step: 0.05, default: 1 },
      { key: "density", type: "number", label: "Density", min: 0, max: 1, step: 0.01, default: 0.3 },
      { key: "intensity", type: "number", label: "Intensity", min: 0, max: 1, step: 0.01, default: 0.5 },
    ],
  },
  voronoi: {
    kind: "voronoi", label: "Voronoi", category: "fill",
    Component: Voronoi as React.ComponentType<Record<string, unknown>>,
    presets: presets(voronoiPresets),
    params: [
      { key: "colors", type: "colors", label: "Colors", default: ["#ffffff", "#7c5cff", "#00c2ff"] },
      { key: "speed", type: "number", label: "Speed", min: 0, max: 3, step: 0.05, default: 1 },
      { key: "scale", type: "number", label: "Scale", min: 0.1, max: 3, step: 0.05, default: 1 },
      { key: "distortion", type: "number", label: "Distortion", min: 0, max: 1, step: 0.01, default: 0.5 },
    ],
  },
  dithering: {
    kind: "dithering", label: "Dithering", category: "fill",
    Component: Dithering as React.ComponentType<Record<string, unknown>>,
    presets: presets(ditheringPresets),
    params: [
      { key: "colorFront", type: "color", label: "Front", default: "#ffffff" },
      { key: "colorBack", type: "color", label: "Back", default: "#000000" },
      { key: "speed", type: "number", label: "Speed", min: 0, max: 3, step: 0.05, default: 1 },
      { key: "scale", type: "number", label: "Scale", min: 0.1, max: 3, step: 0.05, default: 1 },
      { key: "type", type: "select", label: "Pattern", options: ["random", "2x2", "4x4", "8x8"], default: "4x4" },
    ],
  },
  water: {
    kind: "water", label: "Water", category: "image",
    Component: Water as React.ComponentType<Record<string, unknown>>,
    presets: presets(waterPresets),
    params: [
      { key: "speed", type: "number", label: "Speed", min: 0, max: 3, step: 0.05, default: 1 },
      { key: "scale", type: "number", label: "Scale", min: 0.1, max: 3, step: 0.05, default: 1 },
      { key: "highlights", type: "number", label: "Highlights", min: 0, max: 1, step: 0.01, default: 0.5 },
    ],
  },
  flutedGlass: {
    kind: "flutedGlass", label: "Fluted Glass", category: "image",
    Component: FlutedGlass as React.ComponentType<Record<string, unknown>>,
    presets: presets(flutedGlassPresets),
    params: [
      { key: "distortion", type: "number", label: "Distortion", min: 0, max: 1, step: 0.01, default: 0.4 },
      { key: "scale", type: "number", label: "Scale", min: 0.1, max: 3, step: 0.05, default: 1 },
      { key: "speed", type: "number", label: "Speed", min: 0, max: 3, step: 0.05, default: 0 },
    ],
  },
  halftoneDots: {
    kind: "halftoneDots", label: "Halftone Dots", category: "image",
    Component: HalftoneDots as React.ComponentType<Record<string, unknown>>,
    presets: presets(halftoneDotsPresets),
    params: [
      { key: "colorFront", type: "color", label: "Front", default: "#000000" },
      { key: "colorBack", type: "color", label: "Back", default: "#ffffff" },
      { key: "type", type: "select", label: "Style", options: ["classic", "gooey", "holes", "soft"], default: "classic" },
      { key: "speed", type: "number", label: "Speed", min: 0, max: 3, step: 0.05, default: 0 },
    ],
  },
  imageDithering: {
    kind: "imageDithering", label: "Image Dithering", category: "image",
    Component: ImageDithering as React.ComponentType<Record<string, unknown>>,
    presets: presets(imageDitheringPresets),
    params: [
      { key: "colorFront", type: "color", label: "Front", default: "#000000" },
      { key: "colorBack", type: "color", label: "Back", default: "#ffffff" },
      { key: "type", type: "select", label: "Pattern", options: ["random", "2x2", "4x4", "8x8"], default: "4x4" },
      { key: "scale", type: "number", label: "Scale", min: 0.1, max: 3, step: 0.05, default: 1 },
    ],
  },
};

export const SHADER_KINDS = Object.keys(SHADER_REGISTRY) as ShaderKind[];

/** Build a default config (first preset) for the given kind (defaults to meshGradient). */
export function defaultShaderConfig(kind: ShaderKind = "meshGradient"): ShaderConfig {
  const desc = SHADER_REGISTRY[kind];
  return { kind, preset: desc.presets[0]?.name, params: {} };
}
