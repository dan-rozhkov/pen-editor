import type {
  ComponentPropertyDef,
  FlatFrameNode,
  InstanceOverride,
  InstanceOverrides,
  RefNode,
} from "@/types/scene";

/** Resolve a property's effective value on an instance: selected value, else the declared default. */
export function resolvePropertyValue(
  property: ComponentPropertyDef,
  propertyValues: RefNode["propertyValues"],
): string | boolean {
  const selected = propertyValues?.[property.id];
  return selected !== undefined ? selected : property.defaultValue;
}

/** Whether `value` is a legal value for `property` (variant option / boolean / string, per its declared type). */
export function validatePropertyValue(
  property: ComponentPropertyDef,
  value: unknown,
): value is string | boolean {
  switch (property.type) {
    case "variant":
      return typeof value === "string" && (property.variantOptions ?? []).includes(value);
    case "boolean":
      return typeof value === "boolean";
    case "text":
      return typeof value === "string";
    default:
      return false;
  }
}

/**
 * Build the "update" overrides implied by a component's property declarations
 * and an instance's selected property values. Multiple properties that target
 * the same `bindingPath` are merged into a single override's `props`.
 */
export function buildPropertyOverrides(
  properties: ComponentPropertyDef[] | undefined,
  propertyValues: RefNode["propertyValues"],
): InstanceOverrides {
  const overrides: InstanceOverrides = {};
  if (!properties) return overrides;

  for (const property of properties) {
    const value = resolvePropertyValue(property, propertyValues);
    const existing = overrides[property.bindingPath];
    const existingProps = existing?.kind === "update" ? existing.props : {};
    overrides[property.bindingPath] = {
      kind: "update",
      props: { ...existingProps, [property.bindingProp]: value },
    };
  }

  return overrides;
}

/**
 * Compute the overrides that should actually apply when resolving an
 * instance: property-derived overrides (from the component's `properties`
 * declarations and the ref's `propertyValues`) merged with the ref's own
 * explicit `overrides`. Explicit overrides always win at the path level —
 * a "replace" override fully supersedes a property-derived one, and an
 * explicit "update" override's props are merged on top of (and take
 * priority over) the property-derived props at that same path.
 */
export function getEffectiveOverrides(
  component: FlatFrameNode | null | undefined,
  refNode: RefNode,
): InstanceOverrides {
  const properties = component?.properties;
  if (!properties || properties.length === 0) {
    return refNode.overrides ?? {};
  }

  const propertyOverrides = buildPropertyOverrides(properties, refNode.propertyValues);
  const explicitOverrides = refNode.overrides ?? {};
  const merged: InstanceOverrides = { ...propertyOverrides };

  for (const [path, explicit] of Object.entries(explicitOverrides)) {
    const base = merged[path];
    merged[path] = mergeOverrideAtPath(base, explicit);
  }

  return merged;
}

function mergeOverrideAtPath(
  base: InstanceOverride | undefined,
  explicit: InstanceOverride,
): InstanceOverride {
  if (explicit.kind === "replace") return explicit;
  if (base?.kind !== "update") return explicit;
  return { kind: "update", props: { ...base.props, ...explicit.props } };
}
