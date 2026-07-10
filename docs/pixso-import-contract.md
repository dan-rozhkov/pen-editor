# Pixso import contract for 1:1 editor import

This document describes the target JSON contract that a Pixso adapter should
produce when it needs to import a design into this editor with maximum visual
fidelity.

The preferred target is the editor's native document JSON, not the public
`.pen` export format and not the current Figma clipboard compatibility path.
Native document JSON is loaded by `deserializeDocument()` in
`src/utils/fileUtils.ts` and then mounted into the page/scene stores.

## Recommended file shape

Use a `.json` file with document `version: "1.1"`.

```ts
interface PenDocument {
  version: "1.1";
  pages: PenPage[];
  variables?: Variable[];
  textStyles?: TextStyle[];
  fillStyles?: FillStyle[];    // reusable named fill styles (see fills[].styleId)
  effectStyles?: EffectStyle[]; // reusable named effect styles (see effectStyleId)
  activeTheme?: "light" | "dark";
  componentArtifacts?: Record<string, ComponentArtifact>;

  // Legacy single-page format is still accepted, but do not use it for Pixso.
  nodes?: SceneNode[];
}

interface PenPage {
  id: string;
  name: string;
  nodes: SceneNode[];
  pageBackground?: string; // default "#f5f5f5"
  guides?: Guide[];
}

interface Guide {
  id: string;
  orientation: "horizontal" | "vertical";
  position: number; // world x for vertical, world y for horizontal
}
```

Minimal valid document:

```json
{
  "version": "1.1",
  "pages": [
    {
      "id": "page_1",
      "name": "Page 1",
      "pageBackground": "#f5f5f5",
      "nodes": []
    }
  ],
  "variables": [],
  "textStyles": [],
  "activeTheme": "light",
  "componentArtifacts": {}
}
```

## Scene model rules

- `pages[].nodes` is a nested tree. Only `frame` and `group` nodes have
  `children`.
- Every node id must be unique across all pages if components/refs can cross
  pages. Stable ids are better than generated ids for diffs.
- Sibling order is z-order: first child renders at the bottom, last child
  renders on top.
- `x` and `y` are relative to the parent coordinate system. Root nodes use page
  coordinates.
- `width` and `height` are finite numbers in pixels. Avoid negative sizes.
- `rotation` is degrees clockwise. The editor stores rotation, `flipX`, and
  `flipY`, but not an arbitrary affine matrix. For skew/shear/non-uniform
  transforms, convert the object to a `path` or an `image` before import.
- Optional `visible` defaults to `true`. Optional `enabled` defaults to `true`;
  `enabled: false` is mainly for instance override hiding.
- Prefer the modern `fills` and `effects` stacks for fidelity. Legacy fields
  (`fill`, `gradientFill`, `imageFill`, `effect`) are still accepted, but cannot
  represent multiple fills/effects.
- Colors are CSS hex strings. Use `#RRGGBB` or `#RRGGBBAA`.
- Image URLs may be `data:image/...;base64,...` or normal HTTP(S) URLs. For
  portable imports, embed image bytes as data URLs.

## Node contract

```ts
type SceneNode =
  | FrameNode
  | GroupNode
  | RectNode
  | EllipseNode
  | TextNode
  | PathNode
  | LineNode
  | PolygonNode
  | EmbedNode
  | RefNode
  | ConnectorNode;

interface BaseNode {
  id: string;
  type:
    | "frame"
    | "group"
    | "rect"
    | "ellipse"
    | "text"
    | "path"
    | "line"
    | "polygon"
    | "embed"
    | "ref"
    | "connector";
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;

  visible?: boolean;
  enabled?: boolean;
  rotation?: number;
  opacity?: number; // 0..1
  flipX?: boolean;
  flipY?: boolean;

  fill?: string;
  fillOpacity?: number; // 0..1
  fillBinding?: VariableBinding;
  stroke?: string;
  strokeOpacity?: number; // 0..1
  strokeBinding?: VariableBinding;
  strokeWidth?: number;
  strokeAlign?: "center" | "inside" | "outside";
  strokeWidthPerSide?: PerSideStroke;

  imageFill?: ImageFill;
  gradientFill?: GradientFill;
  fills?: Paint[];

  effect?: ShadowEffect;
  effects?: Effect[];
  shader?: ShaderConfig;

  sizing?: SizingProperties;
  absolutePosition?: boolean;
  constraints?: NodeConstraints;

  aspectRatioLocked?: boolean;
  aspectRatio?: number;
  isMask?: boolean;
}
```

### Frame

Use `frame` for Pixso frames, artboards, components, auto-layout containers, and
any object that clips children by bounds.

```ts
interface FrameNode extends BaseNode {
  type: "frame";
  children: SceneNode[];
  cornerRadius?: number;
  cornerRadiusPerCorner?: PerCornerRadius;
  cornerSmoothing?: number; // 0..1
  clip?: boolean;
  layout?: LayoutProperties;
  themeOverride?: "light" | "dark";
  reusable?: boolean;
  isSlot?: boolean;
  layoutGrids?: LayoutGridConfig[];
  properties?: ComponentPropertyDef[];
}
```

### Group

Use `group` for non-layout grouping. Groups should not carry visual fills when
you expect Figma/Pixso-like behavior.

```ts
interface GroupNode extends BaseNode {
  type: "group";
  children: SceneNode[];
  clipGeometry?: string;
  clipBounds?: { x: number; y: number; width: number; height: number };
}
```

### Rect

```ts
interface RectNode extends BaseNode {
  type: "rect";
  cornerRadius?: number;
  cornerRadiusPerCorner?: PerCornerRadius;
  cornerSmoothing?: number; // 0..1
}
```

### Ellipse

```ts
interface EllipseNode extends BaseNode {
  type: "ellipse";
  startAngle?: number; // degrees, default 0
  sweepAngle?: number; // degrees, default 360
  innerRadiusRatio?: number; // 0..1
}
```

### Text

The editor stores one style per text node. If a Pixso text layer has mixed
per-character styling and must remain visually exact, split it into multiple
text nodes or convert it to vector paths.

```ts
interface TextNode extends BaseNode {
  type: "text";
  text: string;
  paragraphs?: ParagraphAttrs[];
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string; // "normal", "bold", or "100".."900"
  fontStyle?: "normal" | "italic" | string;
  underline?: boolean;
  strikethrough?: boolean;
  textWidthMode?: "auto" | "fixed" | "fixed-height";
  textAlign?: "left" | "center" | "right";
  textAlignVertical?: "top" | "middle" | "bottom";
  lineHeight?: number; // multiplier, e.g. 1.2
  letterSpacing?: number; // px
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
  paragraphSpacing?: number; // extra px after each hard-break paragraph
  truncateText?: boolean;
  maxLines?: number;
  link?: TextLink; // { url: string; title?: string } — applies to whole node
  fontVariations?: Record<string, number>; // variable-font axes, e.g. { wght: 530 }
  textStyleId?: string;
  textStyleOverrides?: string[];
}

interface ParagraphAttrs {
  listType?: "none" | "bullet" | "number";
  indentLevel?: number;
}
```

### Path / vector

Use `path` for arbitrary vectors, boolean results, icons, dashed/complex
strokes converted to outlines, skewed objects, and vectorized text.

```ts
interface PathNode extends BaseNode {
  type: "path";
  geometry: string; // SVG path d
  pathStroke?: PathStroke;
  geometryBounds?: { x: number; y: number; width: number; height: number };
  clipGeometry?: string;
  clipBounds?: { x: number; y: number; width: number; height: number };
  fillRule?: "nonzero" | "evenodd";
  points?: PathAnchor[];
  closed?: boolean;
}

interface PathStroke {
  align?: string; // "center" | "inside" | "outside"
  thickness?: number;
  join?: string; // "round" | "bevel" | "miter"
  cap?: string; // "round" | "butt" | "square"
  fill?: string;
}
```

For best fidelity, set `geometryBounds` to the raw path bounds and set node
`x`, `y`, `width`, `height` to the desired layer bounds. If a Pixso vector uses
effects unsupported by the node model, bake them into an image or outline.

### Line

```ts
interface LineNode extends BaseNode {
  type: "line";
  points: number[]; // [x1, y1, x2, y2], relative to node x/y
  startCap?: "none" | "arrow" | "triangle" | "circle" | "bar";
  endCap?: "none" | "arrow" | "triangle" | "circle" | "bar";
}
```

### Polygon

```ts
interface PolygonNode extends BaseNode {
  type: "polygon";
  points: number[]; // [x1, y1, x2, y2, ...], relative to node x/y
  sides?: number;
  innerRadiusRatio?: number; // star mode when set and < 1
}
```

### Embed

Use only when the Pixso adapter intentionally imports live HTML. For static
design fidelity, prefer native nodes or image fills.

```ts
interface EmbedNode extends BaseNode {
  type: "embed";
  htmlContent: string;
  sourceTemplate?: string;
}
```

### Component reference

`ref` points to a reusable `frame` with `reusable: true`.

```ts
interface RefNode extends BaseNode {
  type: "ref";
  componentId: string;
  overrides?: InstanceOverrides;
  propertyValues?: Record<string, string | boolean>;
}

type InstanceOverrides = Record<string, InstanceOverride>;

type InstanceOverride =
  | { kind: "update"; props: Partial<Omit<FlatSceneNode, "id" | "type">> }
  | { kind: "replace"; node: SceneNode };
```

### Connector

```ts
interface ConnectorNode extends BaseNode {
  type: "connector";
  startConnection: { nodeId: string; anchor: "top" | "right" | "bottom" | "left" };
  endConnection: { nodeId: string; anchor: "top" | "right" | "bottom" | "left" };
  points: number[]; // [x1, y1, x2, y2], relative to node x/y
}
```

## Fill contract

`fills` is ordered bottom-to-top. If `fills` is present, it is the source of
truth and legacy `fill`/`gradientFill`/`imageFill` fields are ignored.

A `VideoPaint` (`{ type: "video"; video: VideoFill }`) also exists for
video fills, but is out of scope for a typical Pixso design import.

```ts
type Paint = SolidPaint | GradientPaint | ImagePaint | PatternPaint;

interface PaintBase {
  id: string;
  visible?: boolean; // default true
  opacity?: number; // 0..1, default 1
  blendMode?:
    | "normal"
    | "multiply"
    | "screen"
    | "overlay"
    | "darken"
    | "lighten"
    | "color-dodge"
    | "color-burn"
    | "hard-light"
    | "soft-light"
    | "difference"
    | "exclusion";
}

interface SolidPaint extends PaintBase {
  type: "solid";
  color: string;
  colorBinding?: VariableBinding;
}

interface GradientPaint extends PaintBase {
  type: "gradient";
  gradient: GradientFill;
}

interface ImagePaint extends PaintBase {
  type: "image";
  image: ImageFill;
}

interface PatternPaint extends PaintBase {
  type: "pattern";
  pattern: PatternFill;
}

interface GradientFill {
  type: "linear" | "radial";
  stops: { color: string; position: number; opacity?: number }[];
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  startRadius?: number;
  endRadius?: number;
}

interface ImageFill {
  url: string;
  mode: "fill" | "fit" | "stretch";
}

interface PatternFill {
  url: string;
  scale?: number;
  spacingX?: number;
  spacingY?: number;
  offsetX?: number;
  offsetY?: number;
  rowOffset?: number;
}
```

## Stroke contract

Simple node strokes are solid only. To preserve gradient strokes, dashed
strokes, variable-width strokes, or complex caps exactly, import the stroked
outline as a `path` fill.

```ts
interface PerSideStroke {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}
```

## Effect contract

`effects` is ordered bottom-to-top. If `effects` is present, it supersedes the
legacy single `effect`.

```ts
type Effect = ShadowEffect | BlurEffect | BackgroundBlurEffect;

interface ShadowEffect {
  type: "shadow";
  shadowType: "outer" | "inner"; // Pixso DROP_SHADOW -> outer, INNER_SHADOW -> inner
  color: string; // #RRGGBBAA recommended
  offset: { x: number; y: number };
  blur: number;
  spread: number;
  id?: string;
  visible?: boolean;
}

// Layer blur — blurs the node itself (Pixso LAYER_BLUR).
interface BlurEffect {
  type: "blur";
  radius: number;
  id?: string;
  visible?: boolean;
}

// Backdrop/background blur — blurs whatever is BEHIND the node, for
// glassmorphism (Pixso BACKGROUND_BLUR). Supported natively; do NOT rasterize.
interface BackgroundBlurEffect {
  type: "background-blur";
  radius: number;
  id?: string;
  visible?: boolean;
}
```

Layer blend isolation, advanced filter stacks, and effects that depend on
pixels outside the node in ways none of the above express should be rasterized
for exact import. Drop shadow, inner shadow, layer blur, and background blur all
map to native effects above.

## Layout contract

Auto-layout maps to the editor's flex/Yoga model.

```ts
interface LayoutProperties {
  autoLayout?: boolean;
  flexDirection?: "row" | "column";
  flexWrap?: boolean;
  gap?: number;
  rowGap?: number;
  columnGap?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  alignItems?: "flex-start" | "center" | "flex-end" | "stretch";
  justifyContent?:
    | "flex-start"
    | "center"
    | "flex-end"
    | "space-between"
    | "space-around"
    | "space-evenly";
}

interface SizingProperties {
  widthMode?: "fixed" | "fill_container" | "fit_content";
  heightMode?: "fixed" | "fill_container" | "fit_content";
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
}

interface NodeConstraints {
  horizontal: "min" | "max" | "center" | "stretch" | "scale";
  vertical: "min" | "max" | "center" | "stretch" | "scale";
}
```

If a Pixso frame is not auto-layout, omit `layout` and use `constraints` on
direct children. If it is auto-layout, constraints are ignored by the editor.

## Component contract

Reusable components are normal `frame` nodes with `reusable: true`.

```ts
interface ComponentPropertyDef {
  id: string;
  name: string;
  type: "variant" | "boolean" | "text";
  variantOptions?: string[];
  defaultValue: string | boolean;
  bindingPath: string;
  bindingProp: string;
}

interface ComponentArtifact {
  authoringHtml?: string;
  sourceTemplate?: string;
  revision: number;
  syncState: "in_sync" | "stale_from_native" | "stale_from_html" | "missing" | "failed";
}
```

For Pixso components:

- Import the main component as a `frame` with `reusable: true`.
- Import an instance as `ref` only if `componentId` can resolve to that frame.
- If Pixso variants cannot be expressed cleanly as `ComponentPropertyDef`,
  duplicate them as normal frames or detach instances to plain scene nodes.

## Variables and text styles

```ts
interface Variable {
  id: string;
  name: string;
  type: "color" | "number" | "string";
  value: string;
  themeValues?: { light: string; dark: string };
}

interface VariableBinding {
  variableId: string;
}

interface TextStyle {
  id: string;
  name: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  lineHeight?: number;
  letterSpacing?: number;
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
}
```

Reusable fill/effect styles (Figma-style "Color styles" / "Effect styles") are
also supported at the document level and referenced by id from a node:

```ts
interface FillStyle {
  id: string;
  name: string;
  paint: Paint; // one full paint (solid/gradient/image/pattern)
}

interface EffectStyle {
  id: string;
  name: string;
  effects: Effect[]; // a full shadow/blur stack
}
```

A paint layer references a fill style via `fills[].styleId`; a node references
an effect style via `effectStyleId`. Use `fillBinding`, `strokeBinding`,
`fills[].colorBinding`, `fills[].styleId`, `effectStyleId`, or `textStyleId`
only when the referenced id exists in the same document (in `variables`,
`fillStyles`, `effectStyles`, or `textStyles`).

## Layout grids

```ts
interface LayoutGridConfig {
  id: string;
  type: "grid" | "columns" | "rows";
  visible: boolean;
  color: string;
  opacity: number;
  size?: number;
  count?: number;
  gutter?: number;
  margin?: number;
  width?: number | null;
  alignment?: "stretch" | "center" | "min" | "max";
}
```

## Masks and clipping

- `frame.clip: true` clips children to the frame bounds.
- `isMask: true` makes a node clip sibling nodes above it in the same parent
  until the next mask/end of siblings.
- For exact alpha masks, complex luminance masks, nested mask groups, or
  non-rectangular clipping with soft edges, rasterize the masked result or
  import an outlined path/clip-compatible structure.

## Shader contract

Shaders are editor-native effects, not Pixso-native. Use only if the Pixso
adapter intentionally maps a Pixso effect to one of these editor presets.

```ts
interface ShaderConfig {
  kind:
    | "meshGradient"
    | "waves"
    | "warp"
    | "spiral"
    | "metaballs"
    | "godRays"
    | "voronoi"
    | "dithering"
    | "water"
    | "flutedGlass"
    | "halftoneDots"
    | "imageDithering";
  preset?: string;
  params: Record<string, number | string | string[]>;
}
```

## Existing Figma/Pixso clipboard compatibility path

The current paste importer accepts Figma-like clipboard `text/html` containing:

- `(figmeta)` base64 JSON metadata.
- `(figma)` base64 `fig-kiwi` archive.
- A decoded message with `nodeChanges` and `blobs`.

The supported decoded fields are listed in `src/lib/figmaPaste/figTypes.ts`.
Important supported fields include:

- geometry: `type`, `name`, `visible`, `opacity`, `size`, `transform`
- fills/strokes: `fillPaints`, `strokePaints`, `strokeWeight`, `strokeAlign`,
  `strokeCap`, `strokeJoin`
- effects: `DROP_SHADOW`, `INNER_SHADOW`
- vectors: `fillGeometry`, `strokeGeometry`, `vectorData`
- text: `textData`, `fontSize`, `fontName`, alignment, line height, letter spacing
- auto-layout: stack mode, spacing, padding, alignment, child grow/stretch,
  absolute positioning
- components: symbol/instance data, best-effort override merging

This path is useful for paste interoperability, but it is not the full fidelity
contract. It currently approximates or drops some constructs:

- mixed text styles collapse to the dominant style;
- gradient strokes become solid unless converted to path outlines;
- unsupported node types are skipped;
- unsupported masks are approximated or hidden;
- image fills require embedded image blobs;
- arbitrary transforms beyond position/rotation are not represented natively.

For a controlled Pixso importer, generate the native document JSON described
above. Use the clipboard path only when the goal is "paste what Pixso places on
the system clipboard".

## 1:1 mapping recommendations

- Preserve every Pixso frame/artboard as `frame`; preserve child z-order.
- Preserve Pixso groups as `group` unless they clip, auto-layout, or need a
  background; then use `frame`.
- Use `fills` for all paint stacks, including single fills when you want one
  consistent representation.
- Convert unsupported stroke/fill/effect combinations to `path` outlines or
  image layers before import.
- Split mixed-style text into multiple text nodes, or vectorize it when exact
  typography is more important than editability.
- Embed local images as data URLs to avoid broken imports.
- Keep Pixso component ids stable and map reusable components before refs.
- If Pixso uses a feature the editor cannot represent natively, prefer this
  fallback order: native nodes -> vector outline -> image rasterization.

## Import validation checklist

Before handing a generated file to the editor:

- JSON parses without comments/trailing commas.
- `version` is `"1.1"`.
- `pages` exists and has at least one page.
- Every node has `id`, `type`, `x`, `y`, `width`, and `height`.
- Only `frame` and `group` nodes contain `children`.
- All ids referenced by bindings, refs, connectors, overrides, and text styles
  exist.
- Paint/effect stacks have stable `id` fields.
- Colors are valid CSS hex strings.
- Image data URLs are valid and not empty.
- Numeric fields are finite numbers.
- Parent-child z-order matches Pixso bottom-to-top order.
