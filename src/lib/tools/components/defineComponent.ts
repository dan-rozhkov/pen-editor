import type { EmbedComponentMeta } from "@/types/scene";
import {
  effectiveVariants,
  expandMasterHtml,
  dependencyKeys,
  describeUnknownTags,
  findDependencyCycle,
  parseMaster,
  validateMaster,
} from "@/lib/embedComponents";
import { duplicateKeyWarnings, selectComponentRegistry } from "@/store/componentRegistry";
import { reconcileConsumers } from "@/store/componentSync";
import { upsertMasterNode } from "@/store/componentOps";
import { libraryComponentError } from "@/lib/designSystem/ownership";
import type { ToolHandler } from "../../toolRegistry";
import { KEY_RULE, readKey, toolError } from "./shared";

const STATUSES = ["draft", "stable", "deprecated"] as const;

function readVariants(raw: unknown): Record<string, string[]> | null | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string[]> = {};
  for (const [axis, values] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(values) || values.length === 0 || !values.every((v) => typeof v === "string" && v)) {
      return null;
    }
    out[axis] = values as string[];
  }
  return out;
}

/** `undefined`: not given. `null`: clear. An object: set. `false`: malformed. */
function readDeprecated(raw: unknown): EmbedComponentMeta["deprecated"] | null | undefined | false {
  if (raw === undefined || raw === null) return raw;
  if (typeof raw !== "object" || Array.isArray(raw)) return false;
  const { replacedBy, note } = raw as Record<string, unknown>;
  if (replacedBy !== undefined && typeof replacedBy !== "string") return false;
  if (note !== undefined && typeof note !== "string") return false;
  const out: NonNullable<EmbedComponentMeta["deprecated"]> = {};
  if (replacedBy?.trim()) out.replacedBy = replacedBy.trim();
  if (note?.trim()) out.note = note.trim();
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * define_component: create or update a component master (an embed with
 * `component` on the "Components" page) and re-render every instance.
 */
export const defineComponent: ToolHandler = async (args) => {
  const key = readKey(args);
  if (!key) return toolError(`Invalid key: ${KEY_RULE}`);
  if (typeof args.name !== "string" || !args.name.trim()) return toolError("name is required");
  if (typeof args.html !== "string" || !args.html.trim()) return toolError("html is required");
  const variants = readVariants(args.variants);
  if (variants === null) {
    return toolError("variants must be an object of axis -> non-empty array of value strings");
  }
  if (args.status !== undefined && args.status !== null && !STATUSES.includes(args.status as (typeof STATUSES)[number])) {
    return toolError(`status must be one of ${STATUSES.join(", ")}`);
  }
  if (args.description !== undefined && typeof args.description !== "string") {
    return toolError("description must be a string");
  }
  // Panel-only argument (the backend schema does not carry it): replacement and
  // note of a deprecated component; `null` clears it.
  const deprecated = readDeprecated(args.deprecated);
  if (deprecated === false) return toolError("deprecated must be null or { replacedBy?: string, note?: string }");

  const registry = selectComponentRegistry();
  const existing = registry.get(key);
  const libraryRefusal = libraryComponentError(key, existing?.meta);
  if (libraryRefusal) return toolError(libraryRefusal);
  const effectiveMetaVariants = variants ?? existing?.meta.variants;

  const expandedMaster = expandMasterHtml(args.html, key, registry);
  if (expandedMaster.error) return toolError(`Invalid component "${key}": ${expandedMaster.error}`);
  const validated = validateMaster(expandedMaster.html, key, effectiveMetaVariants);
  if (!validated.ok) return toolError(`Invalid component "${key}": ${validated.errors.join("; ")}`);
  const cycle = findDependencyCycle(registry, key, dependencyKeys(validated.master));
  if (cycle) return toolError(`Component "${key}" would create a dependency cycle: ${cycle.join(" -> ")}`);

  const { description: oldDescription, status: oldStatus, deprecated: oldDeprecated, ...kept } =
    existing?.meta ?? ({} as Partial<EmbedComponentMeta>);
  const description = typeof args.description === "string" ? args.description.trim() : oldDescription;
  const status = args.status === null ? undefined : ((args.status as EmbedComponentMeta["status"]) ?? oldStatus);
  const nextDeprecated =
    deprecated === undefined
      ? oldDeprecated
      : deprecated
        ? { ...(oldDeprecated?.since ? { since: oldDeprecated.since } : {}), ...deprecated }
        : undefined;
  const meta: EmbedComponentMeta = {
    ...kept,
    key,
    name: args.name.trim(),
    ...(effectiveMetaVariants ? { variants: effectiveMetaVariants } : {}),
    ...(description ? { description } : {}),
    ...(status ? { status } : {}),
    ...(nextDeprecated ? { deprecated: nextDeprecated } : {}),
  };

  // One history entry (the master write). Consumers are re-rendered right
  // after WITHOUT their own entry, so undo of the master restores the old
  // consumers with it (see componentSync.ts).
  const written = upsertMasterNode({ meta, html: validated.master.html });
  const updatedEmbeds = reconcileConsumers({ keys: [key] });

  const stored = selectComponentRegistry().get(key);
  const parsed = stored ? parseMaster(stored) : null;
  const unknownNested = validated.master.nested.filter((k) => !registry.has(k));
  const unknownNote = describeUnknownTags(expandedMaster.unknownTags);
  const warnings = [
    ...expandedMaster.warnings,
    ...(unknownNote ? [unknownNote] : []),
    ...(unknownNested.length > 0 ? [`Nested component(s) not defined yet: ${unknownNested.join(", ")}`] : []),
    ...duplicateKeyWarnings(key),
  ];
  return JSON.stringify({
    key,
    created: written.created,
    nodeId: written.nodeId,
    pageId: written.pageId,
    rev: parsed?.rev,
    slots: validated.master.slots,
    variants: stored && parsed ? effectiveVariants(stored, parsed) : {},
    updatedEmbeds,
    ...(warnings.length > 0 ? { warnings } : {}),
  });
};
