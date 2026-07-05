import type { FrameNode, RefNode } from "@/types/scene";
import { useSceneStore } from "@/store/sceneStore";
import { resolvePropertyValue } from "@/utils/componentProperties";
import { CheckboxInput, PropertySection, SelectInput, TextInput } from "@/components/ui/PropertyInputs";

interface InstancePropertiesSectionProps {
  node: RefNode;
  component: FrameNode | null;
}

/**
 * Per-type controls for switching a component instance's declared properties
 * (variant select / boolean toggle / text input). Values are read from
 * `RefNode.propertyValues`, falling back to each property's `defaultValue`.
 * Switching a value only touches `propertyValues` — it never mutates the
 * instance's own path-based `overrides`, so other overrides are unaffected.
 */
export function InstancePropertiesSection({ node, component }: InstancePropertiesSectionProps) {
  const setInstancePropertyValue = useSceneStore((s) => s.setInstancePropertyValue);
  const properties = component?.properties;
  if (!properties || properties.length === 0) return null;

  return (
    <PropertySection title="Properties">
      <div className="flex flex-col gap-2">
        {properties.map((property) => {
          const value = resolvePropertyValue(property, node.propertyValues);
          if (property.type === "variant") {
            return (
              <SelectInput
                key={property.id}
                label={property.name}
                labelOutside
                value={String(value)}
                options={(property.variantOptions ?? []).map((option) => ({ value: option, label: option }))}
                onChange={(next) => setInstancePropertyValue(node.id, property.id, next)}
              />
            );
          }
          if (property.type === "boolean") {
            return (
              <CheckboxInput
                key={property.id}
                label={property.name}
                checked={value === true}
                onChange={(checked) => setInstancePropertyValue(node.id, property.id, checked)}
              />
            );
          }
          return (
            <TextInput
              key={property.id}
              label={property.name}
              value={String(value)}
              onChange={(next) => setInstancePropertyValue(node.id, property.id, next)}
            />
          );
        })}
      </div>
    </PropertySection>
  );
}
