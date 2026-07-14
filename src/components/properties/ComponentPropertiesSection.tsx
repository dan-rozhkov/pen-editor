import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import type { ComponentPropertyDef, ComponentPropertyType, FlatSceneNode, FrameNode } from "@/types/scene";
import { generateId } from "@/types/scene";
import { useSceneStore } from "@/store/sceneStore";
import { getComponentPropertyFieldOptions } from "@/utils/componentPropertyFields";
import { getComponentPropertyTargetOptions } from "@/utils/componentPropertyTargets";
import { NodeIcon } from "@/components/layers/LayerIcons";
import { Checkbox } from "@/components/ui/checkbox";
import { IconButton } from "@/components/ui/IconButton";
import { PropertySection, SelectInput, TextInput } from "@/components/ui/PropertyInputs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useReadOnly } from "@/hooks/useReadOnly";
import { MinusIcon, PlusIcon, TagIcon, TextTIcon, ToggleLeftIcon } from "@phosphor-icons/react";

interface ComponentPropertiesSectionProps {
  node: FrameNode;
}

const TYPE_OPTIONS: { value: ComponentPropertyType; label: string }[] = [
  { value: "variant", label: "Variant" },
  { value: "boolean", label: "Boolean" },
  { value: "text", label: "Text" },
];

const CUSTOM_TARGET_FIELD_VALUE = "__custom__";

function defaultValueForType(type: ComponentPropertyType): string | boolean {
  if (type === "boolean") return true;
  if (type === "variant") return "default";
  return "";
}

function PropertyTypeIcon({ type }: { type: ComponentPropertyType }) {
  if (type === "boolean") return <ToggleLeftIcon size={16} />;
  if (type === "variant") return <TagIcon size={16} />;
  return <TextTIcon size={16} />;
}

function PropertyPopoverTitle({ name, onChange }: { name: string; onChange: (name: string) => void }) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);

  const commitRename = () => {
    const nextName = draftName.trim();
    if (nextName) onChange(nextName);
    else setDraftName(name);
    setIsEditing(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }
    if (event.key === "Escape") {
      setDraftName(name);
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <Input
        aria-label="Property name"
        autoFocus
        className="h-4 min-w-0 flex-1 bg-transparent px-1 text-[11px]"
        value={draftName}
        onBlur={commitRename}
        onChange={(event) => setDraftName(event.target.value)}
        onKeyDown={handleKeyDown}
        onPointerDown={(event) => event.stopPropagation()}
      />
    );
  }

  return (
    <span
      data-testid="property-popover-title"
      className="min-w-0 truncate text-[11px] font-semibold text-text-primary"
      onDoubleClick={() => {
        setDraftName(name);
        setIsEditing(true);
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {name}
    </span>
  );
}

function BooleanDefaultInput({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  const readOnly = useReadOnly();

  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[10px]">Default</Label>
      <Label className="cursor-pointer text-xs">
        <Checkbox
          aria-label="Default"
          checked={checked}
          disabled={readOnly}
          onCheckedChange={(next) => onChange(Boolean(next))}
        />
        On
      </Label>
    </div>
  );
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
  const nodesById = useSceneStore((s) => s.nodesById);
  const childrenById = useSceneStore((s) => s.childrenById);
  const properties = node.properties ?? [];
  const targetNodeOptions = useMemo(
    () => getComponentPropertyTargetOptions(node.id, nodesById, childrenById),
    [node.id, nodesById, childrenById],
  );
  const targetNodeSelectOptions = useMemo(
    () => targetNodeOptions.map((option) => ({
      value: option.value,
      label: option.label,
      icon: (
        <span className="flex size-4 shrink-0 items-center justify-center [&_svg]:!text-inherit [&_svg]:translate-y-px">
          <NodeIcon
            type={option.node.type}
            isComponent={option.node.type === "frame" && option.node.reusable === true}
            isSlot={option.node.type === "frame" && option.node.isSlot === true}
            isMask={option.node.isMask === true}
            layout={option.node.type === "frame" ? option.node.layout : undefined}
          />
        </span>
      ),
    })),
    [targetNodeOptions],
  );

  const targetNodeByPath = useMemo(
    () => new Map(targetNodeOptions.map((option) => [option.value, option.node])),
    [targetNodeOptions],
  );

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
    <PropertySection
      title="Component Properties"
      action={
        <IconButton variant="ghost" size="icon-sm" onClick={addProperty} tooltip="Add property">
          <PlusIcon />
        </IconButton>
      }
    >
      {properties.length > 0 && (
        <div className="flex flex-col gap-1">
          {properties.map((property) => (
            <ComponentPropertyRow
              key={property.id}
              property={property}
              targetNode={targetNodeByPath.get(property.bindingPath)}
              targetNodeOptions={targetNodeOptions}
              targetNodeSelectOptions={targetNodeSelectOptions}
              onUpdate={(updates) => updateProperty(property.id, updates)}
              onRemove={() => removeProperty(property.id)}
            />
          ))}
        </div>
      )}
    </PropertySection>
  );
}

interface ComponentPropertyRowProps {
  property: ComponentPropertyDef;
  targetNode: FlatSceneNode | undefined;
  targetNodeOptions: ReturnType<typeof getComponentPropertyTargetOptions>;
  targetNodeSelectOptions: { value: string; label: string; icon: ReactNode }[];
  onUpdate: (updates: Partial<ComponentPropertyDef>) => void;
  onRemove: () => void;
}

function ComponentPropertyRow({
  property,
  targetNode,
  targetNodeOptions,
  targetNodeSelectOptions,
  onUpdate,
  onRemove,
}: ComponentPropertyRowProps) {
  const targetFieldOptions = useMemo(
    () => getComponentPropertyFieldOptions(targetNode, property.type),
    [property.type, targetNode],
  );
  const hasKnownTargetField = targetFieldOptions.some((option) => option.value === property.bindingProp);
  const targetFieldValue = hasKnownTargetField ? property.bindingProp : CUSTOM_TARGET_FIELD_VALUE;
  const targetFieldSelectOptions = [
    ...targetFieldOptions,
    { value: CUSTOM_TARGET_FIELD_VALUE, label: "Custom field" },
  ];

  const handleTargetNodeChange = (bindingPath: string) => {
    const selectedNode = targetNodeOptions.find((option) => option.value === bindingPath)?.node;
    const fieldOptions = getComponentPropertyFieldOptions(selectedNode, property.type);
    onUpdate({ bindingPath, bindingProp: fieldOptions[0]?.value ?? "" });
  };

  return (
    <div className="flex min-w-0 items-center gap-1">
      <Popover>
        <PopoverTrigger
          className="flex min-w-0 flex-1 items-center gap-2 rounded bg-secondary px-1.5 py-1 text-left text-secondary-foreground hover:bg-secondary data-popup-open:bg-secondary"
          aria-label={`Edit property ${property.name}`}
          title="Edit property"
        >
          <span className="text-text-muted">
            <PropertyTypeIcon type={property.type} />
          </span>
          <span className="min-w-0 flex-1 truncate text-xs text-text-primary">{property.name}</span>
        </PopoverTrigger>
        <PopoverContent
          side="left"
          align="start"
          className="w-[280px]"
          draggable
          dragHandleContent={
            <PropertyPopoverTitle
              name={property.name}
              onChange={(name) => onUpdate({ name })}
            />
          }
        >
                  <SelectInput
                    label="Type"
                    labelOutside
                    value={property.type}
                    options={TYPE_OPTIONS}
                    onChange={(type) => {
                      const nextType = type as ComponentPropertyType;
                      const fieldOptions = getComponentPropertyFieldOptions(targetNode, nextType);
                      onUpdate({
                        type: nextType,
                        defaultValue: defaultValueForType(nextType),
                        variantOptions: nextType === "variant" ? (property.variantOptions ?? ["default"]) : undefined,
                        bindingProp: fieldOptions.some((option) => option.value === property.bindingProp)
                          ? property.bindingProp
                          : (fieldOptions[0]?.value ?? ""),
                      });
                    }}
                  />
                  {property.type === "variant" && (
                    <TextInput
                      label="Options (comma-separated)"
                      value={(property.variantOptions ?? []).join(", ")}
                      onChange={(value) => {
                        const options = value.split(",").map((v) => v.trim()).filter(Boolean);
                        onUpdate({
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
                      labelOutside
                      value={String(property.defaultValue)}
                      options={(property.variantOptions ?? []).map((option) => ({ value: option, label: option }))}
                      onChange={(defaultValue) => onUpdate({ defaultValue })}
                    />
                  )}
                  {property.type === "text" && (
                    <TextInput
                      label="Default"
                      value={String(property.defaultValue)}
                      onChange={(defaultValue) => onUpdate({ defaultValue })}
                    />
                  )}
                  {property.type === "boolean" && (
                    <BooleanDefaultInput
                      checked={property.defaultValue === true}
                      onChange={(defaultValue) => onUpdate({ defaultValue })}
                    />
                  )}
                  <SelectInput
                    label="Target node"
                    labelOutside
                    value={property.bindingPath}
                    options={
                      property.bindingPath && !targetNodeSelectOptions.some((option) => option.value === property.bindingPath)
                        ? [{ value: property.bindingPath, label: `Missing layer (${property.bindingPath})` }, ...targetNodeSelectOptions]
                        : targetNodeSelectOptions
                    }
                    onChange={handleTargetNodeChange}
                  />
                  <SelectInput
                    label="Target field"
                    labelOutside
                    value={targetFieldValue}
                    options={targetFieldSelectOptions}
                    onChange={(value) => onUpdate({ bindingProp: value === CUSTOM_TARGET_FIELD_VALUE ? "" : value })}
                  />
                  {targetFieldValue === CUSTOM_TARGET_FIELD_VALUE && (
                    <TextInput
                      label="Custom field"
                      value={property.bindingProp}
                      onChange={(bindingProp) => onUpdate({ bindingProp })}
                      placeholder="e.g. text, visible, fill"
                    />
                  )}
        </PopoverContent>
      </Popover>
      <IconButton
        type="button"
        variant="ghost"
        size="icon-sm"
        tooltip="Remove property"
        onClick={onRemove}
      >
        <MinusIcon />
      </IconButton>
    </div>
  );
}
