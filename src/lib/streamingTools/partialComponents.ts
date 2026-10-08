import {
  expandComponentTags,
  mentionsRegisteredTag,
  parseMaster,
  stableExpansionEnd,
  type ComponentRegistry,
} from "@/lib/embedComponents";
import { dropOpenComponentTag, repairPartialHtml } from "./partialHtml";

/**
 * Expand the component tags in a streamed, possibly cut-off text for the
 * STORE (progressive `edit_embed_html`): a cut-off tag is dropped, tags still
 * open are closed at the end, and the result is reconciled. Never leaves a
 * raw registered `<c-…>` tag behind. Total: falls back to the input.
 */
export function expandStreamedText(html: string, registry: ComponentRegistry): string {
  if (registry.size === 0 || !html.includes("<c-")) return html;
  try {
    return expandComponentTags(dropOpenComponentTag(html, registry), registry, { partial: true }).html;
  } catch {
    return html;
  }
}

// The expansion of the last stable prefix (everything up to the last complete
// top-level component node) is kept between frames: a frame then only
// expands the new tail. One entry; the registry identity invalidates it.
let prefixCache: { registry: ComponentRegistry; raw: string; out: string } | null = null;

const USED_KEY = /\bdata-c="([a-z][a-z0-9-]*)"/g;

/** The managed `<style>` blocks reconcile would add, injected once at the top. */
function managedStyles(html: string, registry: ComponentRegistry): string {
  const keys = new Set<string>();
  USED_KEY.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = USED_KEY.exec(html))) keys.add(m[1]);
  let out = "";
  for (const key of [...keys].sort()) {
    const master = registry.get(key);
    const css = master ? parseMaster(master)?.css : "";
    if (css) out += `<style data-c-style="${key}">\n${css}\n</style>`;
  }
  return out;
}

/**
 * Preview text for a streaming embed: repair the cut-off tail (a partial
 * `<c-…` tag is dropped first), then expand registered `<c-key>` tags so the
 * preview shows the real component. Runs every frame, so it skips the
 * reconcile pass, adds each component's CSS once, and re-expands only the
 * text after the last complete top-level component.
 */
export function repairAndExpandPartialHtml(raw: string, registry: ComponentRegistry): string {
  const repaired = repairPartialHtml(raw, registry);
  if (registry.size === 0 || !mentionsRegisteredTag(repaired, registry)) return repaired;
  try {
    const end = stableExpansionEnd(repaired, registry);
    const head = repaired.slice(0, end);
    let headOut: string;
    if (prefixCache && prefixCache.registry === registry && prefixCache.raw === head) {
      headOut = prefixCache.out;
    } else {
      headOut = expandComponentTags(head, registry, { reconcile: false }).html;
      prefixCache = { registry, raw: head, out: headOut };
    }
    const tailOut = expandComponentTags(repaired.slice(end), registry, { partial: true, reconcile: false }).html;
    const body = headOut + tailOut;
    return managedStyles(body, registry) + body;
  } catch {
    return repaired;
  }
}
