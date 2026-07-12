# PixiJS performance roadmap

## Context

Large documents with many frames and layers should remain responsive at overview zoom levels such as 10–20%.

## Implemented first stage

- Hierarchical viewport culling for nested Pixi subtrees.
- Conservative handling of masks and rotated subtrees.
- Overview effect LOD at 20% and below:
  - disable renderer-owned shadows;
  - disable background blur;
  - disable layer blur;
  - keep all in-viewport text visible.
- Viewport pan and zoom request a single dirty render instead of starting the generic 1200 ms trailing render window.
- Dev-only access to Pixi refs for performance instrumentation.
- Unit and Chromium E2E coverage for culling, effect restoration, and scheduler behavior.

## Proposed next stages

### 1. Add meaningful performance metrics

The existing FPS counter measures the browser's global `requestAnimationFrame` rate and does not reveal Pixi render cost or unnecessary render calls.

Add a development-only performance overlay or benchmark harness that reports:

- `app.render()` duration: p50, p95, p99, and max;
- render calls per second;
- total, renderable, and culled containers;
- active filters and masks;
- frame gaps above 16.7 ms and 20 ms;
- optional draw-call or batch statistics when exposed by PixiJS.

Suggested acceptance target for the same machine, browser, viewport, and fixture:

- p95 `app.render()` at or below 12 ms;
- no repeated frame spikes above 20 ms;
- rendering stops within two frames after a viewport gesture, except for the explicit safety render.

### 2. Cache stable frames as textures

At overview zoom, replace a complex stable frame subtree with a single sprite backed by a `RenderTexture`.

Restore the live Pixi subtree when:

- the user zooms into the frame;
- the user enters, selects, or edits a descendant;
- frame content or an external dependency changes;
- an animation, video, or interactive embed requires live rendering.

Required safeguards:

- revision-based invalidation;
- an LRU texture cache with a memory budget;
- resolution buckets appropriate for the current zoom;
- correct behavior for themes, variables, component instances, images, masks, blur, and shaders;
- no caching of unstable or continuously animated content.

This is expected to provide the largest next rendering improvement for documents containing many complex screens.

### 3. Add a spatial index for hit testing

Avoid traversing the complete scene tree for hover and selection queries.

Possible implementation:

- maintain world bounds in an R-tree, quadtree, or spatial grid;
- query a small candidate set under the cursor or marquee;
- run exact geometry and instance-descendant hit testing only for candidates;
- update index entries incrementally after node, layout, or hierarchy changes.

Expected improvements:

- smoother hover feedback;
- fewer CPU spikes while moving the pointer;
- faster selection and marquee operations on large scenes.

### 4. Update image and embed resolution only when needed

Current scale changes can still inspect a large portion of the Pixi registry.

Potential changes:

- update only visible image fills and embeds;
- skip culled instance subtrees;
- use discrete resolution buckets to prevent repeated raster work;
- upgrade newly visible content after pan with a debounced queue;
- prioritize content nearest the viewport center;
- reuse compatible component-instance snapshots and textures.

### 5. Use adaptive renderer resolution

On Retina displays, rendering at `devicePixelRatio` increases the physical pixel count substantially even when the document is shown at 10%.

Possible policy:

- overview zoom: renderer resolution 1;
- normal editing zoom: restore `devicePixelRatio`;
- switch resolution only after zoom settles;
- verify text, image, selection overlay, and export sharpness independently.

This should be evaluated after frame caching because resizing renderer buffers can itself be expensive.

### 6. Improve viewport bounds and culling precision

The current implementation deliberately keeps rotated subtrees renderable when axis-aligned local bounds are unsafe.

Potential improvements:

- cache absolute world bounds;
- include rotation, flip, stroke, shadow, and overflow extents;
- cull rotated subtrees safely;
- reduce repeated parent-coordinate accumulation;
- make the culling margin depend on pan velocity;
- use a smaller margin at overview zoom while preventing visible pop-in.

## Recommended order

1. Performance metrics and a deterministic large-scene benchmark.
2. Stable-frame `RenderTexture` cache.
3. Spatial index for hit testing.
4. Visible-only image, embed, and instance resolution updates.
5. Adaptive renderer resolution.
6. More precise rotated bounds and dynamic culling margin.

## Benchmark guidance

Use a deterministic fixture and fixed environment, for example:

- Chromium viewport: 1440×900;
- device pixel ratio: 1 for comparable CPU-focused runs;
- 100 root frames in a grid;
- approximately 100 descendants per frame;
- a representative mix of rectangles, text, images, component instances, masks, and effects;
- zoom levels: 10%, 20%, and 100%;
- five repeated pan runs per configuration, comparing medians.

Record both responsiveness and visual correctness. Every optimization must preserve text visibility, selection behavior, masks, frame clipping, editing transitions, and restoration after zooming in.
