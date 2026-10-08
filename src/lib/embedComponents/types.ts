import type { EmbedComponentMeta } from "@/types/scene";

/** Key slug: lowercase, starts with a letter, at most 40 chars. */
export const COMPONENT_KEY_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;

/** `slot` is reserved for `<c-slot name="...">`. */
export function isValidComponentKey(key: unknown): key is string {
  return typeof key === "string" && COMPONENT_KEY_PATTERN.test(key) && key !== "slot";
}

/** A master as the registry sees it: the node's stored text plus its meta. */
export interface ComponentMaster {
  key: string;
  meta: EmbedComponentMeta;
  /** The master embed's `htmlContent` (normalized by `validateMaster`). */
  html: string;
  /** Source node, when the registry was derived from a scene. */
  nodeId?: string;
  pageId?: string;
}

/** `key -> master`. Only registered keys match `<c-key>` tags / regions. */
export type ComponentRegistry = ReadonlyMap<string, ComponentMaster>;

/** Instance data: the only things an instance may differ in. */
export interface InstanceSpec {
  /** axis -> value (without the `data-v-` prefix). */
  variants?: Record<string, string>;
  /** slot name -> inner HTML. A slot not listed keeps the master default. */
  slots?: Record<string, string>;
  /** Instance-level `style` / `id`. */
  attrs?: { style?: string; id?: string };
}

/** A master parsed into the pieces the engine renders from. */
export interface ParsedMaster {
  key: string;
  /** Scoped stylesheet text (may be empty). */
  css: string;
  /** Root element outerHTML, incl. `data-c` and default `data-v-*`. */
  rootHtml: string;
  rootTag: string;
  /** The master root's own inline `style` ("" when none). */
  rootStyle: string;
  /** axis -> default value, in attribute order. */
  axes: Record<string, string>;
  /** Slot names in document order. */
  slots: string[];
  /** Component keys instantiated inside the master (nested components). */
  nested: string[];
  /** Normalized master HTML: `<style>` + root. */
  html: string;
  rev: string;
}
