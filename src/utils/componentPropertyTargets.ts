import type { FlatSceneNode } from "@/types/scene";
import { getNodeDisplayName } from "@/utils/nodeDisplay";

export interface ComponentPropertyTargetOption {
  value: string;
  label: string;
  node: FlatSceneNode;
}

/**
 * Converts the ID-based override paths used at runtime into labels an author
 * can recognize. The value remains the ID path because that is what instance
 * override resolution expects.
 */
export function getComponentPropertyTargetOptions(
  componentId: string,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
): ComponentPropertyTargetOption[] {
  const options: ComponentPropertyTargetOption[] = [];

  const visit = (parentId: string, idPath: string) => {
    for (const childId of childrenById[parentId] ?? []) {
      const child = nodesById[childId];
      if (!child) continue;

      const path = idPath ? `${idPath}/${child.id}` : child.id;
      options.push({ value: path, label: getNodeDisplayName(child), node: child });
      visit(child.id, path);
    }
  };

  visit(componentId, "");
  return options;
}
