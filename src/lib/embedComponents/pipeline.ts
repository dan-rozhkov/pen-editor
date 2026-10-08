import type { EmbedComponentMeta } from "@/types/scene";
import { findDependencyCycle } from "./cycles";
import { expandComponentTags } from "./expand";
import { validateMaster } from "./master";
import { findManagedZoneViolation, mayContainComponents, reconcileHtml } from "./reconcile";
import type { ComponentRegistry } from "./types";

export interface FinalizeOptions {
  registry: ComponentRegistry;
  /** The embed's current HTML for an UPDATE (enables the write guard); omit for a new embed. */
  previousHtml?: string | null;
  /** Set when the embed is a component master: it is validated, not expanded. */
  masterMeta?: EmbedComponentMeta;
}

export type FinalizeResult =
  | { ok: true; html: string; unknownTags: string[]; warnings: string[] }
  | { ok: false; error: string };

/**
 * The single write-path for embed HTML coming from the agent (`batch_design`
 * and `edit_embed_html`):
 *  - a MASTER is validated and normalized (scoped CSS, one root, cycles);
 *  - any other embed has registered `<c-key>` tags expanded, is checked
 *    against the managed-zone write guard (updates only), and is reconciled
 *    so the managed `<style>` blocks and revisions are right.
 */
export function finalizeEmbedHtml(html: string, options: FinalizeOptions): FinalizeResult {
  const { registry, previousHtml, masterMeta } = options;

  if (masterMeta) {
    const result = validateMaster(html, masterMeta.key, masterMeta.variants);
    if (!result.ok) {
      return { ok: false, error: `Component "${masterMeta.key}": ${result.errors.join("; ")}` };
    }
    const cycle = findDependencyCycle(registry, masterMeta.key, result.master.nested);
    if (cycle) {
      return {
        ok: false,
        error: `Component "${masterMeta.key}" would create a dependency cycle: ${cycle.join(" -> ")}`,
      };
    }
    return { ok: true, html: result.master.html, unknownTags: [], warnings: [] };
  }

  if (registry.size === 0 && !html.includes("<c-")) {
    return { ok: true, html, unknownTags: [], warnings: [] };
  }

  // Guard FIRST, on the text as written: expansion reconciles, and that would
  // silently revert a tampered managed zone instead of refusing the write.
  if (previousHtml != null && mayContainComponents(html)) {
    const violation = findManagedZoneViolation(previousHtml, html, registry);
    if (violation) return { ok: false, error: violation.message };
  }
  const expanded = expandComponentTags(html, registry);
  const out = reconcileHtml(expanded.html, registry);
  return { ok: true, html: out, unknownTags: expanded.unknownTags, warnings: expanded.warnings };
}

/** One-line note for a tool result about unregistered `<c-*>` tags. */
export function describeUnknownTags(unknownTags: string[]): string | null {
  if (unknownTags.length === 0) return null;
  const list = unknownTags.map((t) => `<c-${t}>`).join(", ");
  return `Unknown component tag(s) ${list} were left as written. Define the component first with define_component, or use plain HTML.`;
}
