import type { ComponentPropertyDef, ComponentPropertyType, FrameNode } from "@/types/scene";
import { generateId } from "@/types/scene";
import { useSceneStore } from "@/store/sceneStore";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { CheckboxInput, PropertySection, SelectInput, TextInput } from "@/components/ui/PropertyInputs";
import { TrashIcon } from "@phosphor-icons/react";

interface ComponentPropertiesSectionProps {
  node: FrameNode;
}

const TYPE_OPTIONS: { value: ComponentPropertyType; label: string }[] = [
  { value: "variant", label: "Variant" },
  { value: "boolean", label: "Boolean" },
  { value: "text", label: "Text" },
];

function defaultValueForType(type: ComponentPropertyType): string | boolean {
  if (type === "boolean") return true;
  if (type === "variant") return "default";
  return "";
}

/**
 * Editor for a reusable component's `properties` declaration (Figma-style
 * component-set variant axes). Each property targets a descendant node
 * (`bindingPath`) and one of its fields (`bindingProp`) — e.g. a "State"
 * variant that writes `fill` on the "background" child, or a "Label" text
 * property that writes `text` on a nested text node.
 */
export function ComponentPropertiesSection({ node }: ComponentPropertiesSectionProps) {
  const setComponentProperties = useSceneStore((s) => s.setComponentProperties);
  const properties = node.properties ?? [];

  const updateProperty = (id: string, updates: Partial<ComponentPropertyDef>) => {
    setComponentProperties(
      node.id,
      properties.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    );
  };

  const removeProperty = (id: string) => {
    setComponentProperties(node.id, properties.filter((p) => p.id !== id));
  };

  const addProperty = () => {
    const newProperty: ComponentPropertyDef = {
      id: generateId(),
      name: `Property ${properties.length + 1}`,
      type: "text",
      defaultValue: "",
      bindingPath: "",
      bindingProp: "text",
    };
    setComponentProperties(node.id, [...properties, newProperty]);
  };

  return (
    <PropertySection title="Component Properties">
      <div className="flex flex-col gap-3">
        {properties.map((property) => (
          <div key={property.id} className="flex flex-col gap-1.5 p-2 rounded bg-secondary/50">
            <div className="flex items-center gap-1">
              <div className="flex-1">
                <TextInput
                  value={property.name}
                  onChange={(name) => updateProperty(property.id, { name })}
                  placeholder="Property name"
                />
              </div>
              <IconButton
                tooltip="Remove property"
                type="button"
                variant="secondary"
                size="icon-sm"
                onClick={() => removeProperty(property.id)}
              >
                <TrashIcon size={14} />
              </IconButton>
            </div>
            <SelectInput
              label="Type"
              value={property.type}
              options={TYPE_OPTIONS}
              onChange={(type) =>
                updateProperty(property.id, {
                  type: type as ComponentPropertyType,
                  defaultValue: defaultValueForType(type as ComponentPropertyType),
                  variantOptions: type === "variant" ? (property.variantOptions ?? ["default"]) : undefined,
                })
              }
            />
            {property.type === "variant" && (
              <TextInput
                label="Options (comma-separated)"
                value={(property.variantOptions ?? []).join(", ")}
                onChange={(value) => {
                  const options = value.split(",").map((v) => v.trim()).filter(Boolean);
                  updateProperty(property.id, {
                    variantOptions: options,
                    defaultValue: options.includes(String(property.defaultValue)) ? property.defaultValue : options[0],
                  });
                }}
                placeholder="default, hover, pressed"
              />
            )}
            {property.type === "variant" && (
              <SelectInput
                label="Default"
                value={String(property.defaultValue)}
                options={(property.variantOptions ?? []).map((option) => ({ value: option, label: option }))}
                onChange={(defaultValue) => updateProperty(property.id, { defaultValue })}
              />
            )}
            {property.type === "text" && (
              <TextInput
                label="Default"
                value={String(property.defaultValue)}
                onChange={(defaultValue) => updateProperty(property.id, { defaultValue })}
              />
            )}
            {property.type === "boolean" && (
              <CheckboxInput
                label="Default: on"
                checked={property.defaultValue === true}
                onChange={(defaultValue) => updateProperty(property.id, { defaultValue })}
              />
            )}
            <TextInput
              label="Target path"
              value={property.bindingPath}
              onChange={(bindingPath) => updateProperty(property.id, { bindingPath })}
              placeholder="e.g. label, or icon/inner"
            />
            <TextInput
              label="Target field"
              value={property.bindingProp}
              onChange={(bindingProp) => updateProperty(property.id, { bindingProp })}
              placeholder="e.g. text, visible, fill"
            />
          </div>
        ))}
        <Button type="button" variant="secondary" className="w-full" onClick={addProperty}>
          Add Property
        </Button>
      </div>
    </PropertySection>
  );
}
