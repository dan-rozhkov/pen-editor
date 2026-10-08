import { ownSlots, parseMaster } from "./master";
import type { ComponentMaster, InstanceSpec, ParsedMaster } from "./types";

const VARIANT_ATTR_PREFIX = "data-v-";
/** Master root style a region was rendered with; stored HTML only, ignored by consumers. */
export const MASTER_STYLE_ATTR = "data-c-ms";

/** `a:b` -> `a:b;` so another declaration list can follow. */
function terminated(style: string): string {
  return style.replace(/;?\s*$/, ";");
}

/** Master root style first, instance style after it, so instance declarations win. */
function mergeRootStyle(masterStyle: string, instanceStyle: string | undefined): string {
  const own = (instanceStyle ?? "").trim();
  if (!masterStyle) return own;
  return own ? `${terminated(masterStyle)} ${own}` : masterStyle;
}

/**
 * Inverse of `mergeRootStyle`: the part of a region's style that is the
 * instance's. `masterStyle` is the master style the region was RENDERED with
 * (recorded in `data-c-ms`), not necessarily the current one.
 */
function instanceStyleOf(regionStyle: string, masterStyle: string): string {
  if (!masterStyle) return regionStyle;
  if (regionStyle === masterStyle) return "";
  const prefix = `${terminated(masterStyle)} `;
  return regionStyle.startsWith(prefix) ? regionStyle.slice(prefix.length).trim() : regionStyle;
}

/**
 * Build the region element for one instance: a clone of the master root with
 * the instance's variants, `style`/`id`, slot contents and the revision
 * stamp. Attribute order is fixed (master attrs, then id, style, rev) so the
 * serialized text is deterministic and reconcile is idempotent.
 */
export function renderRegionElement(
  doc: Document,
  parsed: ParsedMaster,
  spec: InstanceSpec,
): Element {
  const template = doc.createElement("template");
  template.innerHTML = parsed.rootHtml;
  const root = template.content.firstElementChild as Element;

  for (const [axis, value] of Object.entries(spec.variants ?? {})) {
    if (axis in parsed.axes) root.setAttribute(VARIANT_ATTR_PREFIX + axis, value);
  }
  if (spec.attrs?.id) root.setAttribute("id", spec.attrs.id);
  const style = mergeRootStyle(parsed.rootStyle, spec.attrs?.style);
  if (style) root.setAttribute("style", style);
  // Remember which master style was merged in, so a later master style change
  // still finds the instance's own declarations (see `readRegionSpec`).
  if (parsed.rootStyle) root.setAttribute(MASTER_STYLE_ATTR, parsed.rootStyle);

  const provided = spec.slots ?? {};
  for (const slot of ownSlots(root)) {
    const name = slot.getAttribute("data-c-slot") ?? "";
    if (name in provided) slot.innerHTML = provided[name];
  }
  root.setAttribute("data-c-rev", parsed.rev);
  return root;
}

/** Read the instance data out of a stored region. */
export function readRegionSpec(region: Element, parsed: ParsedMaster): InstanceSpec {
  const variants: Record<string, string> = {};
  for (const attr of Array.from(region.attributes)) {
    if (!attr.name.startsWith(VARIANT_ATTR_PREFIX)) continue;
    const axis = attr.name.slice(VARIANT_ATTR_PREFIX.length);
    if (axis in parsed.axes) variants[axis] = attr.value;
  }
  const slots: Record<string, string> = {};
  for (const slot of ownSlots(region)) {
    const name = slot.getAttribute("data-c-slot") ?? "";
    if (name && !(name in slots)) slots[name] = slot.innerHTML;
  }
  const attrs: { style?: string; id?: string } = {};
  const style = instanceStyleOf(
    region.getAttribute("style") ?? "",
    region.getAttribute(MASTER_STYLE_ATTR) ?? parsed.rootStyle,
  );
  const id = region.getAttribute("id");
  if (style) attrs.style = style;
  if (id) attrs.id = id;
  return { variants, slots, attrs };
}

/**
 * Render one instance to its stored HTML form (the region only; the managed
 * `<style>` block belongs to the consuming embed and is added by reconcile).
 */
export function renderInstance(master: ComponentMaster, spec: InstanceSpec = {}): string {
  const parsed = parseMaster(master);
  if (!parsed) throw new Error(`Component "${master.key}" has an invalid master`);
  return renderRegionElement(document, parsed, spec).outerHTML;
}
