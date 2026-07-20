import type {
  Effect,
  FlatFrameNode,
  FlatSceneNode,
  LineNode,
  PathNode,
  PolygonNode,
  RectNode,
  TextNode,
} from "../../types/scene";
import { collectDescendantIds } from "../../types/scene";

/**
 * Proportional scale ("Scale tool", hotkey K). Unlike resize, this scales
 * every dimensional property in the selected subtree — geometry AND style
 * (fonts, strokes, radii, effects, auto-layout gap/padding) — by one factor,
 * so a design's proportions stay intact when it's scaled up or down.
 *
 * Coordinate model: `x`/`y` on every node are relative to that node's own
 * parent origin, not an absolute canvas position (confirmed by
 * `applyContainerWrapping` above, which stores `bounds.x - minX` when
 * reparenting). That means scaling composes correctly across nesting depth
 * with NO special-casing: multiplying every node's own x/y/width/height by
 * the same factor (descendants scaled from their parent's local origin,
 * i.e. anchor {0,0}) reproduces the same proportional layout one level
 * deeper, because a child's local frame always starts at its immediate
 * parent's (0,0) regardless of where that parent sits in its own parent.
 * Only the *root* of the scaled subtree needs an explicit anchor (the fixed
 * point of the drag gesture, e.g. the opposite corner) — every descendant
 * is scaled from its own origin. This is what prevents double-scaling
 * nested children: we never fold a parent's size change into a child's
 * position, we simply scale each node's own already-relative numbers once.
 */

const DEFAULT_ANCHOR = { x: 0, y: 0 };

function roundTo(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function scaleEffect(effect: Effect, factor: number): Effect {
  if (effect.type === "shadow") {
    return {
      ...effect,
      offset: { x: roundTo(effect.offset.x * factor), y: roundTo(effect.offset.y * factor) },
      blur: roundTo(effect.blur * factor),
      spread: roundTo(effect.spread * factor),
    };
  }
  if (effect.type === "noise") {
    return {
      ...effect,
      noiseSize: roundTo(effect.noiseSize * factor),
      noiseSizeY: effect.noiseSizeY !== undefined ? roundTo(effect.noiseSizeY * factor) : undefined,
    };
  }
  return { ...effect, radius: roundTo(effect.radius * factor) };
}

/** Scale one node's own properties (not its descendants). Pure — no store access. */
export function scaleNodeProps(
  node: FlatSceneNode,
  factor: number,
  anchor: { x: number; y: number } = DEFAULT_ANCHOR,
  baseSize?: { width: number; height: number },
): Partial<FlatSceneNode> {
  // The base for width/height may differ from the stored value: the scale
  // gesture measures a node's LAYOUT-EFFECTIVE size (yoga-computed for
  // fill_container / fit_content / min-max-clamped nodes), which is what the
  // handles were drawn at and what the anchor was derived from. Committing
  // `storedWidth * factor` for such a node would diverge from what the user
  // visually dragged — so honor an explicit `baseSize` when given.
  const baseWidth = baseSize?.width ?? node.width;
  const baseHeight = baseSize?.height ?? node.height;
  const patch: Record<string, unknown> = {
    x: Math.round(anchor.x + (node.x - anchor.x) * factor),
    y: Math.round(anchor.y + (node.y - anchor.y) * factor),
    width: Math.round(baseWidth * factor),
    height: Math.round(baseHeight * factor),
  };

  if (node.strokeWidth !== undefined) patch.strokeWidth = roundTo(node.strokeWidth * factor);
  if (node.strokeWidthPerSide) {
    const s = node.strokeWidthPerSide;
    patch.strokeWidthPerSide = {
      top: s.top !== undefined ? roundTo(s.top * factor) : undefined,
      right: s.right !== undefined ? roundTo(s.right * factor) : undefined,
      bottom: s.bottom !== undefined ? roundTo(s.bottom * factor) : undefined,
      left: s.left !== undefined ? roundTo(s.left * factor) : undefined,
    };
  }

  if (node.type === "frame" || node.type === "rect") {
    const n = node as FlatFrameNode | RectNode;
    if (n.cornerRadius !== undefined) patch.cornerRadius = roundTo(n.cornerRadius * factor);
    if (n.cornerRadiusPerCorner) {
      const c = n.cornerRadiusPerCorner;
      patch.cornerRadiusPerCorner = {
        topLeft: c.topLeft !== undefined ? roundTo(c.topLeft * factor) : undefined,
        topRight: c.topRight !== undefined ? roundTo(c.topRight * factor) : undefined,
        bottomRight: c.bottomRight !== undefined ? roundTo(c.bottomRight * factor) : undefined,
        bottomLeft: c.bottomLeft !== undefined ? roundTo(c.bottomLeft * factor) : undefined,
      };
    }
  }

  if (node.effect) patch.effect = scaleEffect(node.effect, factor);
  if (node.effects) patch.effects = node.effects.map((e) => scaleEffect(e, factor));

  if (node.type === "text") {
    const t = node as TextNode;
    if (t.fontSize !== undefined) patch.fontSize = roundTo(t.fontSize * factor);
    if (t.letterSpacing !== undefined) patch.letterSpacing = roundTo(t.letterSpacing * factor);
    if (t.paragraphSpacing !== undefined) patch.paragraphSpacing = roundTo(t.paragraphSpacing * factor);
    // lineHeight is a multiplier of fontSize (e.g. 1.2 = 120%), not an
    // absolute value — it already scales implicitly with fontSize, so it's
    // intentionally left untouched here.
  }

  if (node.type === "frame") {
    const f = node as FlatFrameNode;
    if (f.layout) {
      const l = f.layout;
      patch.layout = {
        ...l,
        // autoLayout / flexDirection / alignItems / justifyContent / flexWrap
        // are preserved as-is (fixed/hug sizing modes must not change).
        gap: l.gap !== undefined ? roundTo(l.gap * factor) : undefined,
        rowGap: l.rowGap !== undefined ? roundTo(l.rowGap * factor) : undefined,
        columnGap: l.columnGap !== undefined ? roundTo(l.columnGap * factor) : undefined,
        paddingTop: l.paddingTop !== undefined ? roundTo(l.paddingTop * factor) : undefined,
        paddingRight: l.paddingRight !== undefined ? roundTo(l.paddingRight * factor) : undefined,
        paddingBottom: l.paddingBottom !== undefined ? roundTo(l.paddingBottom * factor) : undefined,
        paddingLeft: l.paddingLeft !== undefined ? roundTo(l.paddingLeft * factor) : undefined,
      };
    }
  }

  if (node.sizing) {
    const s = node.sizing;
    patch.sizing = {
      ...s,
      // widthMode/heightMode ('fixed' | 'fill_container' | 'fit_content')
      // are preserved as-is — only the numeric clamps scale.
      minWidth: s.minWidth !== undefined ? roundTo(s.minWidth * factor) : undefined,
      maxWidth: s.maxWidth !== undefined ? roundTo(s.maxWidth * factor) : undefined,
      minHeight: s.minHeight !== undefined ? roundTo(s.minHeight * factor) : undefined,
      maxHeight: s.maxHeight !== undefined ? roundTo(s.maxHeight * factor) : undefined,
    };
  }

  if (node.type === "line" || node.type === "polygon") {
    const pts = (node as LineNode | PolygonNode).points;
    if (pts) patch.points = pts.map((v) => roundTo(v * factor));
  }

  if (node.type === "path") {
    const p = node as PathNode;
    if (p.pathStroke?.thickness !== undefined) {
      patch.pathStroke = { ...p.pathStroke, thickness: roundTo(p.pathStroke.thickness * factor) };
    }
    // Note: the SVG `geometry` path data / `points` anchors are NOT
    // rewritten — scaling an SVG path string correctly requires a
    // command-aware parser (arc radii/flags must not scale like coordinates
    // do). Left as a follow-up; scaling a path node currently resizes its
    // bounding box/stroke but not its literal curve geometry.
  }

  return patch as Partial<FlatSceneNode>;
}

/**
 * Recursively compute scaled updates for a set of subtree roots and all of
 * their descendants. Descendants are always scaled from their own parent's
 * local origin (anchor {0,0}) — see the module doc comment above for why
 * that's what makes nesting compose correctly. Only root ids honor the
 * `anchors` map (the fixed point of the drag gesture); omit it to scale
 * every root from its own current position (anchor {0,0} in ITS parent's
 * space too, i.e. the root's top-left-relative-to-its-parent stays put).
 *
 * `baseSizes` (per root id) overrides the stored width/height used as the
 * scale base for that root — pass the gesture's effective (layout) size so
 * the committed geometry matches what was visually dragged.
 *
 * Overlapping roots are deduped: a root that is a descendant of another root
 * is dropped (it would otherwise be patched twice with different anchor
 * bases → incoherent geometry). It is still scaled once, as that ancestor's
 * descendant (anchor {0,0}).
 */
export function computeScaleUpdates(
  rootIds: string[],
  factor: number,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
  anchors?: Record<string, { x: number; y: number }>,
  baseSizes?: Record<string, { width: number; height: number }>,
): Record<string, Partial<FlatSceneNode>> {
  const updates: Record<string, Partial<FlatSceneNode>> = {};

  // Uniquify, then drop any root that is a descendant of another root.
  const uniqueRoots = [...new Set(rootIds)];
  const descendantsByRoot = new Map<string, Set<string>>();
  for (const id of uniqueRoots) {
    descendantsByRoot.set(id, new Set(collectDescendantIds(id, childrenById)));
  }
  const effectiveRoots = uniqueRoots.filter(
    (id) => !uniqueRoots.some((other) => other !== id && descendantsByRoot.get(other)!.has(id)),
  );

  function visit(id: string, anchor: { x: number; y: number }, baseSize?: { width: number; height: number }): void {
    const node = nodesById[id];
    if (!node) return;
    updates[id] = scaleNodeProps(node, factor, anchor, baseSize);
    for (const childId of childrenById[id] ?? []) {
      // Descendants always scale from their own origin against their stored
      // size (they weren't independently measured by the gesture).
      visit(childId, DEFAULT_ANCHOR);
    }
  }

  for (const id of effectiveRoots) {
    visit(id, anchors?.[id] ?? DEFAULT_ANCHOR, baseSizes?.[id]);
  }

  return updates;
}
