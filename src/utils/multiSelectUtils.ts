import type { SceneNode } from "@/types/scene";

// Keys to skip when comparing nodes
const SKIP_KEYS = new Set(["id", "children", "name"]);

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const keysA = Object.keys(aObj);
  const keysB = Object.keys(bObj);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => Object.prototype.hasOwnProperty.call(bObj, k) && deepEqual(aObj[k], bObj[k]));
}

export interface MergedProperties {
  /** Synthetic node using first node's values as base */
  node: SceneNode;
  /** Keys where values differ across selected nodes */
  mixedKeys: Set<string>;
  /** Unique node types in selection */
  types: Set<SceneNode["type"]>;
  /** Whether all selected nodes are the same type */
  isSameType: boolean;
}

export function computeMergedProperties(nodes: SceneNode[]): MergedProperties {
  if (nodes.length === 0) {
    throw new Error("computeMergedProperties requires at least one node");
  }

  const types = new Set(nodes.map((n) => n.type));
  const isSameType = types.size === 1;
  const mixedKeys = new Set<string>();

  // Use first node as base
  const base = nodes[0];

  // Collect all keys from all nodes
  const allKeys = new Set<string>();
  for (const node of nodes) {
    for (const key of Object.keys(node)) {
      allKeys.add(key);
    }
  }

  // Compare each key across all nodes
  for (const key of allKeys) {
    if (SKIP_KEYS.has(key)) continue;
    const baseVal = (base as unknown as Record<string, unknown>)[key];
    for (let i = 1; i < nodes.length; i++) {
      const otherVal = (nodes[i] as unknown as Record<string, unknown>)[key];
      if (!deepEqual(baseVal, otherVal)) {
        mixedKeys.add(key);
        break;
      }
    }
  }

  return {
    node: { ...base },
    mixedKeys,
    types,
    isSameType,
  };
}

export type SharedSection =
  | "position"
  | "size"
  | "appearance"
  | "fill"
  | "stroke"
  | "effects";

// Mapping of node types to which sections they support
const SECTION_MAP: Record<SceneNode["type"], SharedSection[]> = {
  frame: ["position", "size", "appearance", "fill", "stroke", "effects"],
  group: ["position", "size", "appearance", "fill", "stroke", "effects"],
  rect: ["position", "size", "appearance", "fill", "stroke", "effects"],
  ellipse: ["position", "size", "appearance", "fill", "stroke", "effects"],
  text: ["position", "size", "appearance", "fill", "stroke", "effects"],
  ref: ["position", "size", "appearance", "fill", "stroke", "effects"],
  path: ["position", "size", "appearance", "fill", "stroke", "effects"],
  line: ["position", "size", "appearance", "stroke", "effects"],
  polygon: ["position", "size", "appearance", "fill", "stroke", "effects"],
};

/** Returns the intersection of applicable property sections for given node types */
export function getSharedSections(types: Set<SceneNode["type"]>): Set<SharedSection> {
  const typeArray = Array.from(types);
  if (typeArray.length === 0) return new Set();

  // Start with all sections for the first type
  let shared = new Set(SECTION_MAP[typeArray[0]] ?? []);

  // Intersect with each subsequent type
  for (let i = 1; i < typeArray.length; i++) {
    const sections = new Set(SECTION_MAP[typeArray[i]] ?? []);
    shared = new Set([...shared].filter((s) => sections.has(s)));
  }

  return shared;
}
