import type { EmbedComponentMeta } from "@/types/scene";
import {
  effectiveVariants,
  findDependencyCycle,
  parseMaster,
  validateMaster,
} from "@/lib/embedComponents";
import { selectComponentRegistry } from "@/store/componentRegistry";
import { reconcileConsumers } from "@/store/componentSync";
import { upsertMasterNode } from "@/store/componentOps";
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
  if (args.status !== undefined && !STATUSES.includes(args.status as (typeof STATUSES)[number])) {
    return toolError(`status must be one of ${STATUSES.join(", ")}`);
  }
  if (args.description !== undefined && typeof args.description !== "string") {
    return toolError("description must be a string");
  }

  const registry = selectComponentRegistry();
  const existing = registry.get(key);
  const effectiveMetaVariants = variants ?? existing?.meta.variants;

  const validated = validateMaster(args.html, key, effectiveMetaVariants);
  if (!validated.ok) return toolError(`Invalid component "${key}": ${validated.errors.join("; ")}`);
  const cycle = findDependencyCycle(registry, key, validated.master.nested);
  if (cycle) return toolError(`Component "${key}" would create a dependency cycle: ${cycle.join(" -> ")}`);

  const meta: EmbedComponentMeta = {
    ...(existing?.meta ?? {}),
    key,
    name: args.name.trim(),
    ...(effectiveMetaVariants ? { variants: effectiveMetaVariants } : {}),
    ...(typeof args.description === "string" ? { description: args.description } : {}),
    ...(args.status ? { status: args.status as EmbedComponentMeta["status"] } : {}),
  };

  // One history entry (the master write). Consumers are re-rendered right
  // after WITHOUT their own entry, so undo of the master restores the old
  // consumers with it (see componentSync.ts).
  const written = upsertMasterNode({ meta, html: validated.master.html });
  const updatedEmbeds = reconcileConsumers({ keys: [key] });

  const stored = selectComponentRegistry().get(key);
  const parsed = stored ? parseMaster(stored) : null;
  const unknownNested = validated.master.nested.filter((k) => !registry.has(k));
  return JSON.stringify({
    key,
    created: written.created,
    nodeId: written.nodeId,
    pageId: written.pageId,
    rev: parsed?.rev,
    slots: validated.master.slots,
    variants: stored && parsed ? effectiveVariants(stored, parsed) : {},
    updatedEmbeds,
    ...(unknownNested.length > 0
      ? { warnings: [`Nested component(s) not defined yet: ${unknownNested.join(", ")}`] }
      : {}),
  });
};
