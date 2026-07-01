# Shader Nodes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users add a shader node and apply a `@paper-design/shaders` shader to any existing node, rendered as a DOM overlay above the Pixi canvas.

**Architecture:** A single optional `shader?: ShaderConfig` field on `BaseNode` drives everything. A curated registry maps shader kinds to library components + presets + editable param schemas. A `ShaderLayer` DOM overlay (mirroring the existing `EmbedLayer`) mounts the library's React component over each shader-bearing node; image-filter shaders receive the node rasterized via Pixi's `extract`. UI is a properties section + a toolbar tool. No AI-agent tool in v1.

**Tech Stack:** React 19, PixiJS 8.16, Zustand, Vitest + happy-dom, `@paper-design/shaders-react@0.0.76`.

## Global Constraints

- Frontend repo only: `/Users/daniilrozhkov/prj/pen-editor-app/pen-editor`.
- Pin the dependency exactly: `@paper-design/shaders-react@0.0.76` (library warns of breaking changes across `0.0.x`).
- `@/` path alias maps to `src/`.
- TypeScript strict, `noUnusedLocals`/`noUnusedParameters`. `npm run lint` must stay at 0 errors.
- Unit tests live in `src/**/__tests__/`, run with `npm test`. Never initialize PixiJS or require WebGL in unit tests (happy-dom has none).
- `npm run build` (`tsc -b && vite build`) must pass.
- Import order: React → third-party → `@/` aliases → relative.

---

### Task 1: Dependency + `ShaderConfig` type + `BaseNode.shader`

**Files:**
- Modify: `package.json` (add dependency)
- Modify: `src/types/scene.ts` (add `ShaderKind`, `ShaderConfig`, `BaseNode.shader`)
- Test: `src/types/__tests__/shaderConfig.test.ts`

**Interfaces:**
- Produces: `ShaderKind` (string union), `ShaderConfig { kind: ShaderKind; preset?: string; params: Record<string, number | string | string[]> }`, and `BaseNode.shader?: ShaderConfig`.

- [ ] **Step 1: Install the pinned dependency**

Run: `cd /Users/daniilrozhkov/prj/pen-editor-app/pen-editor && npm install --save-exact @paper-design/shaders-react@0.0.76`
Expected: `package.json` gains `"@paper-design/shaders-react": "0.0.76"` under `dependencies`.

- [ ] **Step 2: Add the type (write it, then a type-level test)**

In `src/types/scene.ts`, above `export interface BaseNode`, add:

```ts
/** Curated set of paper-design/shaders exposed in the editor. */
export type ShaderKind =
  | 'meshGradient' | 'waves' | 'warp' | 'spiral'
  | 'metaballs' | 'godRays' | 'voronoi' | 'dithering'
  | 'water' | 'flutedGlass' | 'halftoneDots' | 'imageDithering'

/**
 * A live shader overlay attached to a node (rendered by ShaderLayer, not Pixi).
 * `params` holds prop overrides on top of the selected preset.
 */
export interface ShaderConfig {
  kind: ShaderKind
  preset?: string
  params: Record<string, number | string | string[]>
}
```

Then inside `BaseNode`, after the `effects?: Effect[]` field, add:

```ts
  /** Live shader overlay (paper-design/shaders). Rendered by ShaderLayer. */
  shader?: ShaderConfig
```

- [ ] **Step 3: Write the test**

Create `src/types/__tests__/shaderConfig.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { RectNode, ShaderConfig } from "@/types/scene";

describe("ShaderConfig on BaseNode", () => {
  it("attaches to a node and carries kind/preset/params", () => {
    const cfg: ShaderConfig = {
      kind: "meshGradient",
      preset: "default",
      params: { speed: 1, colors: ["#ff0000", "#0000ff"] },
    };
    const node: RectNode = {
      id: "n1", type: "rect", x: 0, y: 0, width: 100, height: 100, shader: cfg,
    };
    expect(node.shader?.kind).toBe("meshGradient");
    expect(node.shader?.params.speed).toBe(1);
  });
});
```

- [ ] **Step 4: Run the test**

Run: `npm test -- shaderConfig`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/types/scene.ts src/types/__tests__/shaderConfig.test.ts
git commit -m "feat(shaders): add ShaderConfig type and pin paper-design/shaders-react"
```

---

### Task 2: Curated shader registry + prop builder

**Files:**
- Create: `src/lib/shaders/registry.ts`
- Create: `src/lib/shaders/buildShaderProps.ts`
- Test: `src/lib/shaders/__tests__/registry.test.ts`

**Interfaces:**
- Consumes: `ShaderKind`, `ShaderConfig` from `@/types/scene`.
- Produces:
  - `ParamSchema { key: string; type: 'color' | 'colors' | 'number' | 'select'; label: string; min?: number; max?: number; step?: number; options?: string[]; default: number | string | string[] }`
  - `ShaderDescriptor { kind: ShaderKind; label: string; category: 'fill' | 'image'; Component: React.FC<any>; presets: { name: string; params: Record<string, unknown> }[]; params: ParamSchema[] }`
  - `SHADER_REGISTRY: Record<ShaderKind, ShaderDescriptor>`
  - `SHADER_KINDS: ShaderKind[]`
  - `defaultShaderConfig(kind?: ShaderKind): ShaderConfig`
  - `buildShaderProps(cfg: ShaderConfig, image?: string): Record<string, unknown>`

- [ ] **Step 1: Write the registry**

Create `src/lib/shaders/registry.ts`. Presets come from the library's exported `*Presets` arrays; map each preset to `{ name, params }` where `params` is the preset's `.params`.

```ts
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
  Component: React.FC<Record<string, unknown>>;
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
    Component: MeshGradient as React.FC<Record<string, unknown>>,
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
    Component: Waves as React.FC<Record<string, unknown>>,
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
    Component: Warp as React.FC<Record<string, unknown>>,
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
    Component: Spiral as React.FC<Record<string, unknown>>,
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
    Component: Metaballs as React.FC<Record<string, unknown>>,
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
    Component: GodRays as React.FC<Record<string, unknown>>,
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
    Component: Voronoi as React.FC<Record<string, unknown>>,
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
    Component: Dithering as React.FC<Record<string, unknown>>,
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
    Component: Water as React.FC<Record<string, unknown>>,
    presets: presets(waterPresets),
    params: [
      { key: "speed", type: "number", label: "Speed", min: 0, max: 3, step: 0.05, default: 1 },
      { key: "scale", type: "number", label: "Scale", min: 0.1, max: 3, step: 0.05, default: 1 },
      { key: "highlights", type: "number", label: "Highlights", min: 0, max: 1, step: 0.01, default: 0.5 },
    ],
  },
  flutedGlass: {
    kind: "flutedGlass", label: "Fluted Glass", category: "image",
    Component: FlutedGlass as React.FC<Record<string, unknown>>,
    presets: presets(flutedGlassPresets),
    params: [
      { key: "distortion", type: "number", label: "Distortion", min: 0, max: 1, step: 0.01, default: 0.4 },
      { key: "scale", type: "number", label: "Scale", min: 0.1, max: 3, step: 0.05, default: 1 },
      { key: "speed", type: "number", label: "Speed", min: 0, max: 3, step: 0.05, default: 0 },
    ],
  },
  halftoneDots: {
    kind: "halftoneDots", label: "Halftone Dots", category: "image",
    Component: HalftoneDots as React.FC<Record<string, unknown>>,
    presets: presets(halftoneDotsPresets),
    params: [
      { key: "colorFront", type: "color", label: "Front", default: "#000000" },
      { key: "colorBack", type: "color", label: "Back", default: "#ffffff" },
      { key: "type", type: "select", label: "Grid", options: ["1", "2"], default: "1" },
      { key: "speed", type: "number", label: "Speed", min: 0, max: 3, step: 0.05, default: 0 },
    ],
  },
  imageDithering: {
    kind: "imageDithering", label: "Image Dithering", category: "image",
    Component: ImageDithering as React.FC<Record<string, unknown>>,
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
```

- [ ] **Step 2: Write the prop builder**

Create `src/lib/shaders/buildShaderProps.ts`:

```ts
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
```

- [ ] **Step 3: Write the test**

Create `src/lib/shaders/__tests__/registry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SHADER_REGISTRY, SHADER_KINDS, defaultShaderConfig } from "../registry";
import { buildShaderProps } from "../buildShaderProps";

describe("shader registry", () => {
  it("every kind has a component, >=1 preset, and non-empty params", () => {
    for (const kind of SHADER_KINDS) {
      const d = SHADER_REGISTRY[kind];
      expect(typeof d.Component).toBe("function");
      expect(d.presets.length).toBeGreaterThan(0);
      expect(d.params.length).toBeGreaterThan(0);
      expect(["fill", "image"]).toContain(d.category);
    }
  });

  it("defaultShaderConfig resolves the first preset", () => {
    const cfg = defaultShaderConfig("waves");
    expect(cfg.kind).toBe("waves");
    expect(cfg.preset).toBe(SHADER_REGISTRY.waves.presets[0].name);
  });

  it("buildShaderProps fills defaults then applies overrides", () => {
    const props = buildShaderProps({ kind: "meshGradient", params: { speed: 2 } });
    expect(props.speed).toBe(2); // override wins
    expect(props.distortion).toBe(0.8); // default filled
  });

  it("buildShaderProps injects image only for image-filter shaders", () => {
    const img = "data:image/png;base64,AAAA";
    expect(buildShaderProps({ kind: "water", params: {} }, img).image).toBe(img);
    expect(buildShaderProps({ kind: "meshGradient", params: {} }, img).image).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run the test**

Run: `npm test -- shaders/__tests__/registry`
Expected: PASS. If a `*Presets` array is empty for some kind, replace that kind's `presets` fallback with a literal `[{ name: "default", params: {} }]` and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/lib/shaders/registry.ts src/lib/shaders/buildShaderProps.ts src/lib/shaders/__tests__/registry.test.ts
git commit -m "feat(shaders): curated shader registry and prop builder"
```

---

### Task 3: Node rasterization helper (for image-filter shaders)

**Files:**
- Create: `src/lib/shaders/nodeRaster.ts`

**Interfaces:**
- Consumes: `getNodeContainer` from `@/pixi/pixiSync`, `useCanvasRefStore` from `@/store/canvasRefStore`.
- Produces: `extractNodeImage(nodeId: string): Promise<string | null>` — a PNG data URL of the node's current Pixi rendering, or `null` if the app/container isn't ready.

- [ ] **Step 1: Write the helper**

Create `src/lib/shaders/nodeRaster.ts`:

```ts
import { getNodeContainer } from "@/pixi/pixiSync";
import { useCanvasRefStore } from "@/store/canvasRefStore";

/**
 * Rasterize a scene node's current Pixi rendering to a PNG data URL, for use as
 * the `image` input of an image-filter shader. Returns null when Pixi isn't ready
 * or the node has no container yet. Not unit-tested (requires WebGL).
 */
export async function extractNodeImage(nodeId: string): Promise<string | null> {
  const app = useCanvasRefStore.getState().pixiRefs?.app;
  const container = getNodeContainer(nodeId);
  if (!app || !container) return null;
  try {
    return await app.renderer.extract.base64({ target: container });
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b`
Expected: no errors (confirms `extract.base64` signature and imports resolve).

- [ ] **Step 3: Commit**

```bash
git add src/lib/shaders/nodeRaster.ts
git commit -m "feat(shaders): node rasterization helper for image filters"
```

Note: no unit test — `extract` needs WebGL, excluded from unit tests like `get_screenshot`.

---

### Task 4: `ShaderLayer` DOM overlay + mount

**Files:**
- Create: `src/components/canvas/ShaderLayer.tsx`
- Modify: `src/pixi/PixiCanvas.tsx` (mount `<ShaderLayer />` next to `<EmbedLayer />`)
- Test: `src/components/canvas/__tests__/ShaderLayer.test.tsx`

**Interfaces:**
- Consumes: `SHADER_REGISTRY` + `buildShaderProps`, `extractNodeImage`, `embedScreenRect`, `getNodeAbsolutePositionWithLayout`, and the scene/layout/viewport stores.
- Produces: `ShaderLayer` React component (default export-free named export).

- [ ] **Step 1: Write the component**

Create `src/components/canvas/ShaderLayer.tsx`. It mirrors `EmbedLayer` positioning, but mounts the registry component instead of shadow-DOM HTML, and derives a clip shape from the node.

```tsx
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
 * hit the underlying Pixi node (mirrors EmbedLayer).
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
```

Note `zIndex: 9` — below the embed layer (10) so embeds still sit on top.

- [ ] **Step 2: Mount it in PixiCanvas**

In `src/pixi/PixiCanvas.tsx`, add the import after the EmbedLayer import (line 9):

```ts
import { ShaderLayer } from "@/components/canvas/ShaderLayer";
```

And render it right before `<EmbedLayer />` (near line 354):

```tsx
      <ShaderLayer />
      <EmbedLayer />
```

- [ ] **Step 3: Write the test (mock the registry so no WebGL is needed)**

Create `src/components/canvas/__tests__/ShaderLayer.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { ShaderLayer } from "../ShaderLayer";
import { resetStores, seedScene } from "@/test/fixtures";
import { useSceneStore } from "@/store/sceneStore";

// Replace the real (WebGL) shader components with a plain marker div.
vi.mock("@/lib/shaders/registry", () => {
  const Fake = () => <div data-fake-shader />;
  return {
    SHADER_REGISTRY: {
      meshGradient: { kind: "meshGradient", label: "Mesh", category: "fill", Component: Fake, presets: [{ name: "default", params: {} }], params: [] },
    },
    SHADER_KINDS: ["meshGradient"],
    defaultShaderConfig: () => ({ kind: "meshGradient", preset: "default", params: {} }),
  };
});
vi.mock("@/lib/shaders/nodeRaster", () => ({ extractNodeImage: vi.fn().mockResolvedValue(null) }));

describe("<ShaderLayer />", () => {
  beforeEach(() => resetStores());

  it("renders no hosts when no node has a shader", () => {
    seedScene([{ id: "r1", type: "rect", x: 0, y: 0, width: 10, height: 10 }]);
    const { container } = render(<ShaderLayer />);
    expect(container.querySelectorAll("[data-shader-id]").length).toBe(0);
  });

  it("renders a host with the shader component for a shader-bearing node", () => {
    seedScene([{ id: "r1", type: "rect", x: 0, y: 0, width: 10, height: 10,
      shader: { kind: "meshGradient", preset: "default", params: {} } }]);
    const { container } = render(<ShaderLayer />);
    expect(container.querySelector('[data-shader-id="r1"]')).toBeTruthy();
    expect(container.querySelector("[data-fake-shader]")).toBeTruthy();
  });

  it("drops the host when the shader is cleared", () => {
    seedScene([{ id: "r1", type: "rect", x: 0, y: 0, width: 10, height: 10,
      shader: { kind: "meshGradient", preset: "default", params: {} } }]);
    const { container, rerender } = render(<ShaderLayer />);
    expect(container.querySelector('[data-shader-id="r1"]')).toBeTruthy();
    useSceneStore.getState().updateNode("r1", { shader: undefined });
    rerender(<ShaderLayer />);
    expect(container.querySelector('[data-shader-id="r1"]')).toBeNull();
  });
});
```

- [ ] **Step 4: Run the test**

Run: `npm test -- ShaderLayer`
Expected: PASS. (If `seedScene`/`resetStores` signatures differ, mirror the exact usage in `src/components/canvas/__tests__/EmbedLayer.test.tsx`.)

- [ ] **Step 5: Commit**

```bash
git add src/components/canvas/ShaderLayer.tsx src/pixi/PixiCanvas.tsx src/components/canvas/__tests__/ShaderLayer.test.tsx
git commit -m "feat(shaders): ShaderLayer DOM overlay renders shaders over nodes"
```

---

### Task 5: `ShaderSection` properties UI

**Files:**
- Create: `src/components/properties/ShaderSection.tsx`
- Modify: `src/components/properties/PropertyEditor.tsx` (render the section)
- Test: `src/components/properties/__tests__/ShaderSection.test.tsx`

**Interfaces:**
- Consumes: `SHADER_REGISTRY`, `SHADER_KINDS`, `defaultShaderConfig` from `@/lib/shaders/registry`; the `{ node, onUpdate }` section contract used by other sections (`onUpdate(updates: Partial<SceneNode>)`).
- Produces: `ShaderSection({ node, onUpdate }): JSX`.

- [ ] **Step 1: Write the section**

Create `src/components/properties/ShaderSection.tsx`. Uses plain inputs (existing sections use themed markup; keep it simple and dependency-free).

```tsx
import type { SceneNode, ShaderKind } from "@/types/scene";
import { SHADER_REGISTRY, SHADER_KINDS, defaultShaderConfig } from "@/lib/shaders/registry";

interface Props {
  node: SceneNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
}

// Shaders only make visual sense on these node types.
const SHADER_TYPES = new Set(["rect", "frame", "ellipse", "text", "path"]);

export function ShaderSection({ node, onUpdate }: Props) {
  if (!SHADER_TYPES.has(node.type)) return null;
  const shader = node.shader;

  const setShader = (updates: Partial<NonNullable<SceneNode["shader"]>>) => {
    if (!shader) return;
    onUpdate({ shader: { ...shader, ...updates } });
  };
  const setParam = (key: string, value: number | string | string[]) => {
    if (!shader) return;
    onUpdate({ shader: { ...shader, params: { ...shader.params, [key]: value } } });
  };

  return (
    <div className="border-b border-border px-3 py-2 flex flex-col gap-2" data-testid="shader-section">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text-muted">Shader</span>
        <input
          type="checkbox"
          aria-label="Enable shader"
          checked={shader != null}
          onChange={(e) => onUpdate({ shader: e.target.checked ? defaultShaderConfig() : undefined })}
        />
      </div>

      {shader && (
        <>
          <label className="flex items-center justify-between text-xs">
            <span className="text-text-muted">Type</span>
            <select
              aria-label="Shader type"
              className="bg-surface-panel text-text-default rounded px-1 py-0.5"
              value={shader.kind}
              onChange={(e) => onUpdate({ shader: defaultShaderConfig(e.target.value as ShaderKind) })}
            >
              {SHADER_KINDS.map((k) => (
                <option key={k} value={k}>{SHADER_REGISTRY[k].label}</option>
              ))}
            </select>
          </label>

          <label className="flex items-center justify-between text-xs">
            <span className="text-text-muted">Preset</span>
            <select
              aria-label="Shader preset"
              className="bg-surface-panel text-text-default rounded px-1 py-0.5"
              value={shader.preset ?? ""}
              onChange={(e) => setShader({ preset: e.target.value, params: {} })}
            >
              {SHADER_REGISTRY[shader.kind].presets.map((p) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
          </label>

          {SHADER_REGISTRY[shader.kind].params.map((p) => {
            const current = shader.params[p.key];
            if (p.type === "number") {
              const val = typeof current === "number" ? current : (p.default as number);
              return (
                <label key={p.key} className="flex items-center justify-between text-xs">
                  <span className="text-text-muted">{p.label}</span>
                  <input
                    type="range" aria-label={p.label}
                    min={p.min} max={p.max} step={p.step} value={val}
                    onChange={(e) => setParam(p.key, Number(e.target.value))}
                  />
                </label>
              );
            }
            if (p.type === "select") {
              const val = typeof current === "string" ? current : (p.default as string);
              return (
                <label key={p.key} className="flex items-center justify-between text-xs">
                  <span className="text-text-muted">{p.label}</span>
                  <select aria-label={p.label} value={val}
                    className="bg-surface-panel text-text-default rounded px-1 py-0.5"
                    onChange={(e) => setParam(p.key, e.target.value)}>
                    {p.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </label>
              );
            }
            if (p.type === "color") {
              const val = typeof current === "string" ? current : (p.default as string);
              return (
                <label key={p.key} className="flex items-center justify-between text-xs">
                  <span className="text-text-muted">{p.label}</span>
                  <input type="color" aria-label={p.label} value={val}
                    onChange={(e) => setParam(p.key, e.target.value)} />
                </label>
              );
            }
            // 'colors': edit the first two swatches for simplicity in v1.
            const arr = Array.isArray(current) ? current : (p.default as string[]);
            return (
              <div key={p.key} className="flex items-center justify-between text-xs">
                <span className="text-text-muted">{p.label}</span>
                <span className="flex gap-1">
                  {arr.slice(0, 4).map((c, i) => (
                    <input key={i} type="color" aria-label={`${p.label} ${i + 1}`} value={c}
                      onChange={(e) => {
                        const next = [...arr];
                        next[i] = e.target.value;
                        setParam(p.key, next);
                      }} />
                  ))}
                </span>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire into PropertyEditor**

In `src/components/properties/PropertyEditor.tsx`, add the import with the other section imports:

```ts
import { ShaderSection } from "@/components/properties/ShaderSection";
```

And render it after `<EffectsSection ... />` (line 99):

```tsx
      <ShaderSection node={node} onUpdate={onUpdate} />
```

- [ ] **Step 3: Write the test**

Create `src/components/properties/__tests__/ShaderSection.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ShaderSection } from "../ShaderSection";
import type { SceneNode } from "@/types/scene";

const rect = (over: Partial<SceneNode> = {}): SceneNode =>
  ({ id: "r1", type: "rect", x: 0, y: 0, width: 100, height: 100, ...over }) as SceneNode;

describe("<ShaderSection />", () => {
  it("returns null for unsupported node types", () => {
    const { container } = render(<ShaderSection node={rect({ type: "line" }) as SceneNode} onUpdate={vi.fn()} />);
    expect(container.querySelector('[data-testid="shader-section"]')).toBeNull();
  });

  it("enabling the toggle adds a default shader config", () => {
    const onUpdate = vi.fn();
    render(<ShaderSection node={rect()} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByLabelText("Enable shader"));
    expect(onUpdate).toHaveBeenCalledWith({ shader: expect.objectContaining({ kind: "meshGradient" }) });
  });

  it("changing a numeric param merges into params", () => {
    const onUpdate = vi.fn();
    render(<ShaderSection node={rect({ shader: { kind: "meshGradient", preset: "default", params: {} } })} onUpdate={onUpdate} />);
    fireEvent.change(screen.getByLabelText("Speed"), { target: { value: "2" } });
    expect(onUpdate).toHaveBeenCalledWith({ shader: expect.objectContaining({ params: expect.objectContaining({ speed: 2 }) }) });
  });

  it("switching kind resets to that kind's default config", () => {
    const onUpdate = vi.fn();
    render(<ShaderSection node={rect({ shader: { kind: "meshGradient", preset: "default", params: {} } })} onUpdate={onUpdate} />);
    fireEvent.change(screen.getByLabelText("Shader type"), { target: { value: "waves" } });
    expect(onUpdate).toHaveBeenCalledWith({ shader: expect.objectContaining({ kind: "waves" }) });
  });
});
```

- [ ] **Step 4: Run the test**

Run: `npm test -- ShaderSection`
Expected: PASS. (This test imports the real registry, which imports `@paper-design/shaders-react`. If importing it pulls in WebGL at module load and crashes happy-dom, add a `vi.mock("@/lib/shaders/registry", ...)` block like in the ShaderLayer test with `meshGradient` + `waves` fakes that include the `speed` param.)

- [ ] **Step 5: Commit**

```bash
git add src/components/properties/ShaderSection.tsx src/components/properties/PropertyEditor.tsx src/components/properties/__tests__/ShaderSection.test.tsx
git commit -m "feat(shaders): shader properties section with presets and param controls"
```

---

### Task 6: Toolbar "Shader" tool → create shader node

**Files:**
- Modify: `src/store/drawModeStore.ts` (add `'shader'` to `DrawToolType`)
- Modify: `src/pixi/interaction/drawController.ts` (create rect-with-shader)
- Modify: `src/components/PrimitivesPanel.tsx` (add the toolbar button)
- Test: `src/pixi/interaction/__tests__/shaderTool.test.ts`

**Interfaces:**
- Consumes: `defaultShaderConfig` from `@/lib/shaders/registry`; existing `createDrawnNode` switch in `drawController.ts`.
- Produces: `makeShaderNode(id, x, y, width, height)` exported from `drawController.ts` for testability.

- [ ] **Step 1: Add the tool type**

In `src/store/drawModeStore.ts`, extend the union (line 3):

```ts
export type DrawToolType = 'cursor' | 'frame' | 'rect' | 'ellipse' | 'text' | 'line' | 'polygon' | 'embed' | 'pencil' | 'connector' | 'shader'
```

- [ ] **Step 2: Write the failing test**

Create `src/pixi/interaction/__tests__/shaderTool.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeShaderNode } from "../drawController";

describe("makeShaderNode", () => {
  it("creates a rect node carrying a default fill shader", () => {
    const n = makeShaderNode("s1", 5, 6, 200, 150);
    expect(n.type).toBe("rect");
    expect(n.x).toBe(5);
    expect(n.width).toBe(200);
    expect(n.shader?.kind).toBe("meshGradient");
    expect(n.fill).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run it (fails — not exported yet)**

Run: `npm test -- shaderTool`
Expected: FAIL with `makeShaderNode is not a function` / import error.

- [ ] **Step 4: Implement**

In `src/pixi/interaction/drawController.ts`, add the import at the top with the other `@/` imports:

```ts
import { defaultShaderConfig } from "@/lib/shaders/registry";
```

Add this exported helper above `createDrawnNode` (module scope, near the top of the file — not inside another function):

```ts
/** Build a shader node: a plain rect pre-loaded with the default fill shader. */
export function makeShaderNode(
  id: string, x: number, y: number, width: number, height: number,
): SceneNode {
  return { id, type: "rect", x, y, width, height, shader: defaultShaderConfig() };
}
```

Then add a case to the `switch (tool)` in `createDrawnNode`, after the `"embed"` case (line 111):

```ts
      case "shader":
        node = makeShaderNode(id, x, y, width, height);
        break;
```

- [ ] **Step 5: Run the test**

Run: `npm test -- shaderTool`
Expected: PASS.

- [ ] **Step 6: Add the toolbar button**

In `src/components/PrimitivesPanel.tsx`, add a button that calls `toggleTool("shader")`, following the exact markup/pattern of the existing `embed` tool button in that file (same wrapper, active-state class, and an icon — reuse whatever icon component the neighboring tools import; a sparkle/wand-style icon is appropriate). Place it next to the embed button. Match the surrounding code's props exactly.

- [ ] **Step 7: Verify build, lint, full test run**

Run: `npm run lint && npm test && npm run build`
Expected: lint 0 errors, all tests pass, build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/store/drawModeStore.ts src/pixi/interaction/drawController.ts src/components/PrimitivesPanel.tsx src/pixi/interaction/__tests__/shaderTool.test.ts
git commit -m "feat(shaders): add Shader toolbar tool that creates a shader node"
```

---

### Task 7: Manual verification & docs

**Files:**
- Modify: `pen-editor/CLAUDE.md` (one line noting shaders render in `ShaderLayer`, WebGL, excluded from unit tests like `get_screenshot`)

- [ ] **Step 1: Run the app and verify**

Run: `npm run dev`, then in the browser:
1. Click the Shader toolbar tool, drag to create a node → an animated mesh gradient appears and moves.
2. Select it → the Shader section shows type/preset/param controls; change speed/colors/preset → the canvas updates live.
3. Select an existing rect, enable a fill shader → shader fills it, clipped to corner radius.
4. Select a rect with an image/solid fill, choose an image-filter shader (Water/Fluted Glass) → the node's rendered content appears distorted.
5. Pan/zoom → the shader stays aligned to the node. Undo/redo add/remove works.

- [ ] **Step 2: Add the doc line**

Under the "Architecture" / rendering notes in `pen-editor/CLAUDE.md`, add:

```
- Shader nodes/effects (paper-design/shaders) render as a DOM/WebGL overlay in `src/components/canvas/ShaderLayer.tsx` (like EmbedLayer). WebGL — not unit-tested; the registry/prop-builder/section are.
```

- [ ] **Step 3: Commit**

```bash
git add pen-editor/CLAUDE.md
git commit -m "docs(shaders): note ShaderLayer rendering in CLAUDE.md"
```

---

## Self-Review

**Spec coverage:**
- Dependency pin → Task 1. ✓
- `ShaderConfig` on `BaseNode` → Task 1. ✓
- Curated registry (fill + image) + param schema → Task 2. ✓
- Prop builder (preset < defaults < overrides; image inject) → Task 2. ✓
- Node→image raster for image filters → Task 3, consumed in Task 4. ✓
- `ShaderLayer` overlay, positioning, clip, pointer-events, no renderScheduler change → Task 4. ✓
- "Add a shader node" via toolbar → Task 6. ✓
- "Apply shader to existing node" (fill + image) via `ShaderSection` toggle → Task 5. ✓
- Testing strategy (registry/mapping/section unit; WebGL excluded) → Tasks 2, 4, 5, 7. ✓
- Out of scope (AI tool, HTML export/screenshot) → untouched. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. The only prose-described step is the PrimitivesPanel button (Task 6 Step 6), which is deliberately "match the neighboring embed button exactly" because that file's exact markup should be followed rather than guessed — the reviewer verifies it renders and toggles.

**Type consistency:** `ShaderConfig`/`ShaderKind` names consistent across tasks; `defaultShaderConfig`, `buildShaderProps`, `extractNodeImage`, `makeShaderNode`, `SHADER_REGISTRY`, `SHADER_KINDS` used with identical signatures where referenced. `onUpdate(updates: Partial<SceneNode>)` matches the existing section contract. Shader clear uses `updateNode(id, { shader: undefined })`, consistent with the section toggle.
