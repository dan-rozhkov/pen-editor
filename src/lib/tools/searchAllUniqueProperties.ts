import { useSceneStore } from "@/store/sceneStore";
import type { FlatSceneNode } from "@/types/scene";
import type { ToolHandler } from "../toolRegistry";
import { getFills, getPrimarySolidColor } from "@/utils/fillUtils";

/**
 * Collect every solid-paint color of a node, covering both the legacy `fill`
 * field and the Figma-style `fills` stack. `getFills` already falls back to the
 * legacy fields when `fills` is unset, so this captures both representations.
 */
function collectFillColors(n: FlatSceneNode): string[] {
  const colors: string[] = [];
  for (const paint of getFills(n)) {
    if (paint.type === "solid") colors.push(paint.color);
  }
  return colors;
}

/**
 * API property name → how to extract values from a flat node. Each extractor
 * returns zero or more values; `undefined`/`null` entries are filtered by the
 * collection loop.
 */
type PropertyExtractor = (node: FlatSceneNode) => readonly unknown[];

const extractors: Record<string, PropertyExtractor> = {
  fillColor: (n) => collectFillColors(n),
  // Text color is the topmost visible solid paint (covers both the legacy
  // `fill` field and the `fills` stack — see fillUtils).
  textColor: (n) => (n.type === "text" ? [getPrimarySolidColor(n)] : []),
  strokeColor: (n) => [n.stroke],
  strokeThickness: (n) => [n.strokeWidth],
  fontSize: (n) => (n.type === "text" ? [n.fontSize] : []),
  fontFamily: (n) => (n.type === "text" ? [n.fontFamily] : []),
  fontWeight: (n) => (n.type === "text" ? [n.fontWeight] : []),
  cornerRadius: (n) =>
    n.type === "frame" || n.type === "rect"
      ? [(n as unknown as Record<string, unknown>).cornerRadius]
      : [],
  cornerRadiusPerCorner: (n) =>
    n.type === "frame" || n.type === "rect"
      ? [(n as unknown as Record<string, unknown>).cornerRadiusPerCorner]
      : [],
  padding: (n) => {
    if (n.type !== "frame") return [];
    const layout = (n as unknown as Record<string, unknown>).layout as
      | Record<string, unknown>
      | undefined;
    if (!layout) return [];
    const { paddingTop, paddingRight, paddingBottom, paddingLeft } = layout as {
      paddingTop?: number;
      paddingRight?: number;
      paddingBottom?: number;
      paddingLeft?: number;
    };
    if (
      paddingTop === undefined &&
      paddingRight === undefined &&
      paddingBottom === undefined &&
      paddingLeft === undefined
    )
      return [];
    return [paddingTop ?? 0];
  },
  gap: (n) => {
    if (n.type !== "frame") return [];
    const layout = (n as unknown as Record<string, unknown>).layout as
      | Record<string, unknown>
      | undefined;
    return [layout?.gap];
  },
};

export const searchAllUniqueProperties: ToolHandler = async (args) => {
  const parents = args.parents as string[] | undefined;
  const properties = args.properties as string[] | undefined;

  if (!parents || parents.length === 0) {
    return JSON.stringify({ error: "No parent IDs provided" });
  }
  if (!properties || properties.length === 0) {
    return JSON.stringify({ error: "No properties specified" });
  }

  // Capture for closure narrowing
  const propList = properties;
  const { nodesById, childrenById } = useSceneStore.getState();

  // Collect unique values per property
  const result: Record<string, unknown[]> = {};
  for (const prop of propList) {
    result[prop] = [];
  }

  const valueSets: Record<string, Set<string>> = {};
  for (const prop of propList) {
    valueSets[prop] = new Set();
  }

  function walk(nodeId: string) {
    const node = nodesById[nodeId];
    if (!node) return;

    for (const prop of propList) {
      const extractor = extractors[prop];
      if (!extractor) continue;
      for (const val of extractor(node)) {
        if (val !== undefined && val !== null) {
          const key = JSON.stringify(val);
          if (!valueSets[prop].has(key)) {
            valueSets[prop].add(key);
            result[prop].push(val);
          }
        }
      }
    }

    const childIds = childrenById[nodeId];
    if (childIds) {
      for (const cid of childIds) {
        walk(cid);
      }
    }
  }

  for (const pid of parents) {
    walk(pid);
  }

  return JSON.stringify(result);
};
