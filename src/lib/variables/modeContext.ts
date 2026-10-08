import {
  THEME_COLLECTION_ID,
  type ModeContext,
  type ModeOverrides,
  type ThemeName,
  type VariableCollection,
} from "@/types/variable";
import type { SceneNode } from "@/types/scene";

export type { ModeOverrides };

const NO_OVERRIDES: ModeOverrides = Object.freeze({});

interface FrameLike {
  type?: string;
  modeOverrides?: ModeOverrides;
  themeOverride?: ThemeName;
}

/**
 * The compat choke point: every reader of a frame's per-collection picks goes
 * through here, so a legacy `themeOverride` and a v2 `modeOverrides` mean the
 * same thing. Frames only; any other node has no overrides. The returned
 * object may be shared and must not be mutated.
 */
export function getFrameModeOverrides(node: FrameLike | null | undefined): ModeOverrides {
  if (!node || node.type !== "frame") return NO_OVERRIDES;
  if (node.modeOverrides) return node.modeOverrides;
  if (node.themeOverride) return { [THEME_COLLECTION_ID]: node.themeOverride };
  return NO_OVERRIDES;
}

/** `base` with every pick in `overrides` applied. Returns `base` itself when there is nothing to apply. */
export function mergeModeContext(base: ModeContext, overrides: ModeOverrides | undefined): ModeContext {
  if (!overrides) return base;
  let out: ModeContext | null = null;
  for (const [collectionId, modeId] of Object.entries(overrides)) {
    if (modeId === undefined || base[collectionId] === modeId) continue;
    out ??= { ...base };
    out[collectionId] = modeId;
  }
  return out ?? base;
}

/**
 * The context a node resolves under: `base` plus every ancestor frame's
 * overrides, root to leaf (inner wins). A frame's own overrides affect its
 * descendants, not the frame itself, unless `includeSelf` is set.
 */
export function getEffectiveModeContext(
  parentById: Record<string, string | null>,
  nodesById: Record<string, FrameLike | undefined>,
  nodeId: string,
  base: ModeContext,
  opts: { includeSelf?: boolean } = {},
): ModeContext {
  const chain: string[] = [];
  const seen = new Set<string>();
  let cur: string | null | undefined = opts.includeSelf ? nodeId : parentById[nodeId];
  while (cur != null && !seen.has(cur)) {
    seen.add(cur);
    chain.push(cur);
    cur = parentById[cur];
  }
  let ctx = base;
  for (let i = chain.length - 1; i >= 0; i--) {
    ctx = mergeModeContext(ctx, getFrameModeOverrides(nodesById[chain[i]]));
  }
  return ctx;
}

/** A stable string for a context: use it as a Zustand selector result or an effect dependency. */
export function modeContextKey(ctx: ModeContext): string {
  return Object.keys(ctx)
    .sort()
    .map((k) => `${k}=${ctx[k]}`)
    .join("|");
}

export function modeOverridesEqual(a: ModeOverrides | undefined, b: ModeOverrides | undefined): boolean {
  if (a === b) return true;
  const ak = Object.keys(a ?? {});
  const bk = Object.keys(b ?? {});
  if (ak.length !== bk.length) return false;
  return ak.every((k) => (a as ModeOverrides)[k] === (b as ModeOverrides | undefined)?.[k]);
}

/** Keeps only picks that name a known collection and one of its modes. Undefined when nothing is left. */
export function pruneModeOverrides(
  overrides: ModeOverrides | undefined,
  collections: VariableCollection[],
): ModeOverrides | undefined {
  if (!overrides) return undefined;
  const out: ModeOverrides = {};
  for (const [collectionId, modeId] of Object.entries(overrides)) {
    const collection = collections.find((c) => c.id === collectionId);
    if (collection && modeId !== undefined && collection.modes.some((m) => m.id === modeId)) {
      out[collectionId] = modeId;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Same as `pruneModeOverrides` for a document-level context (empty object, not undefined, when nothing is left). */
export function sanitizeModeContext(ctx: ModeContext | undefined, collections: VariableCollection[]): ModeContext {
  return (pruneModeOverrides(ctx, collections) ?? {}) as ModeContext;
}

/**
 * The mode every collection shows under `ctx`: its pick when that names one of
 * its modes, else its default. One key per collection, in collection order.
 */
export function completeModeContext(collections: VariableCollection[], ctx: ModeContext): ModeContext {
  const out: ModeContext = {};
  for (const c of collections) {
    const picked = ctx[c.id];
    out[c.id] = picked !== undefined && c.modes.some((m) => m.id === picked) ? picked : c.defaultModeId;
  }
  return out;
}

/**
 * Load-time migration over a flat node map: a frame's `themeOverride` becomes
 * `modeOverrides: { theme }` (the old key is dropped), and picks naming a
 * deleted collection or mode are pruned. Idempotent. Returns the input map
 * itself when no frame changed; changed frames are new objects.
 */
export function migrateFrameModeOverrides<T extends object>(
  nodesById: Record<string, T>,
  collections: VariableCollection[],
): Record<string, T> {
  let out: Record<string, T> | null = null;
  for (const [id, node] of Object.entries(nodesById)) {
    const frame = node as FrameLike;
    if (frame.type !== "frame") continue;
    if (frame.modeOverrides === undefined && frame.themeOverride === undefined) continue;
    const { themeOverride: _legacy, modeOverrides: _current, ...rest } = frame as FrameLike & Record<string, unknown>;
    void _legacy;
    void _current;
    const pruned = pruneModeOverrides(getFrameModeOverrides(frame), collections);
    out ??= { ...nodesById };
    out[id] = (pruned ? { ...rest, modeOverrides: pruned } : rest) as T;
  }
  return out ?? nodesById;
}

/**
 * Save-time dual-write over a scene tree: each frame gets its effective
 * `modeOverrides` plus a `themeOverride` mirror of the Theme pick, so a build
 * that only knows `themeOverride` still opens the file. Empty overrides are
 * dropped. Returns the input array itself when nothing needed changing.
 */
export function withThemeOverrideMirror(nodes: SceneNode[]): SceneNode[] {
  let changed = false;
  const next = nodes.map((node) => {
    let out: SceneNode = node;
    const children = (node as { children?: SceneNode[] }).children;
    if (Array.isArray(children)) {
      const mapped = withThemeOverrideMirror(children);
      if (mapped !== children) out = { ...node, children: mapped } as SceneNode;
    }
    const frame = node as FrameLike;
    if (frame.type === "frame" && (frame.modeOverrides !== undefined || frame.themeOverride !== undefined)) {
      const effective = getFrameModeOverrides(frame);
      const { themeOverride: _t, modeOverrides: _m, ...rest } = out as SceneNode & Record<string, unknown>;
      void _t;
      void _m;
      const theme = effective[THEME_COLLECTION_ID];
      out = {
        ...rest,
        ...(Object.keys(effective).length > 0 ? { modeOverrides: effective } : {}),
        ...(theme ? { themeOverride: theme as ThemeName } : {}),
      } as SceneNode;
    }
    if (out !== node) changed = true;
    return out;
  });
  return changed ? next : nodes;
}
