import type { ComponentPropertyType, FlatSceneNode } from "@/types/scene";

export interface ComponentPropertyFieldOption {
  value: string;
  label: string;
}

/**
 * Lists the supported instance-override fields for a component property.
 * The list is constrained by both the property value type and target layer
 * type, while callers can still offer a custom-field escape hatch.
 */
export function getComponentPropertyFieldOptions(
  node: FlatSceneNode | undefined,
  propertyType: ComponentPropertyType,
): ComponentPropertyFieldOption[] {
  if (!node) return [];

  if (propertyType === "boolean") {
    const options: ComponentPropertyFieldOption[] = [
      { value: "visible", label: "Visible" },
      { value: "enabled", label: "Enabled" },
      { value: "flipX", label: "Flip horizontally" },
      { value: "flipY", label: "Flip vertically" },
      { value: "absolutePosition", label: "Absolute position" },
      { value: "isMask", label: "Use as mask" },
    ];

    if (node.type === "frame") {
      options.push(
        { value: "clip", label: "Clip content" },
        { value: "isSlot", label: "Is slot" },
      );
    }

    return options;
  }

  const options: ComponentPropertyFieldOption[] = [];
  if (node.type === "text") options.push({ value: "text", label: "Text" });

  if (node.type !== "group" && node.type !== "ref" && node.type !== "connector") {
    options.push(
      { value: "fill", label: "Fill" },
      { value: "stroke", label: "Stroke" },
    );
  }

  return options;
}
