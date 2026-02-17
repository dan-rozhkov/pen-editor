import { useSceneStore } from "@/store/sceneStore";
import type { FlatSceneNode } from "@/types/scene";
import type { ToolHandler } from "../toolRegistry";

/** API property name → how to extract value from a flat node */
type PropertyExtractor = (node: FlatSceneNode) => unknown;

const extractors: Record<string, PropertyExtractor> = {
  fillColor: (n) => n.fill,
  textColor: (n) => (n.type === "text" ? n.fill : undefined),
  strokeColor: (n) => n.stroke,
  strokeThickness: (n) => n.strokeWidth,
  fontSize: (n) => (n.type === "text" ? n.fontSize : undefined),
  fontFamily: (n) => (n.type === "text" ? n.fontFamily : undefined),
  fontWeight: (n) => (n.type === "text" ? n.fontWeight : undefined),
  cornerRadius: (n) =>
    n.type === "frame" || n.type === "rect"
      ? (n as unknown as Record<string, unknown>).cornerRadius
      : undefined,
  padding: (n) => {
    if (n.type !== "frame") return undefined;
    const layout = (n as unknown as Record<string, unknown>).layout as
      | Record<string, unknown>
      | undefined;
    if (!layout) return undefined;
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
      return undefined;
    return paddingTop ?? 0;
  },
  gap: (n) => {
    if (n.type !== "frame") return undefined;
    const layout = (n as unknown as Record<string, unknown>).layout as
      | Record<string, unknown>
      | undefined;
    return layout?.gap;
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
      const val = extractor(node);
      if (val !== undefined && val !== null) {
        const key = JSON.stringify(val);
        if (!valueSets[prop].has(key)) {
          valueSets[prop].add(key);
          result[prop].push(val);
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
