import { expandComponentTags, mentionsRegisteredTag, type ComponentRegistry } from "@/lib/embedComponents";
import { repairPartialHtml } from "./partialHtml";

/**
 * Preview text for a streaming embed: repair the cut-off tail (a partial
 * `<c-…` tag is dropped first), then expand registered `<c-key>` tags so the
 * preview shows the real component. Unregistered tags and tags still open
 * stay as written. Total: any failure falls back to the repaired text.
 */
export function repairAndExpandPartialHtml(raw: string, registry: ComponentRegistry): string {
  const repaired = repairPartialHtml(raw);
  if (registry.size === 0 || !mentionsRegisteredTag(repaired, registry)) return repaired;
  try {
    return expandComponentTags(repaired, registry).html;
  } catch {
    return repaired;
  }
}
