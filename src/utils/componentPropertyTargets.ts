import type { FlatSceneNode } from "@/types/scene";

export interface ComponentPropertyTargetOption {
  value: string;
  label: string;
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

  const visit = (parentId: string, idPath: string, namePath: string[]) => {
    for (const childId of childrenById[parentId] ?? []) {
      const child = nodesById[childId];
      if (!child) continue;

      const path = idPath ? `${idPath}/${child.id}` : child.id;
      const name = child.name?.trim() || child.type;
      const labels = [...namePath, name];
      options.push({ value: path, label: labels.join(" / ") });
      visit(child.id, path, labels);
    }
  };

  visit(componentId, "", []);
  return options;
}
