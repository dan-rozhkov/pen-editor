import type { EmbedComponentMeta } from "@/types/scene";
import { validateMaster } from "../master";
import type { ComponentMaster, ComponentRegistry } from "../types";

export const BTN_HTML = `<style>
  [data-c="btn"] { padding: var(--space-2) var(--space-4); border-radius: var(--radius-md); }
  [data-c="btn"][data-v-kind="primary"] { background: var(--color-accent); color: var(--color-on-accent); }
</style>
<button data-c="btn" data-v-kind="primary"><span data-c-slot="label">Save</span></button>`;

export const CARD_HTML = `<style>.title { font-weight: 600 }</style>
<section data-c="card"><h3 class="title" data-c-slot="title">Title</h3><div data-c-slot="body">Body</div></section>`;

/** Build a registry from `{key: html}`; masters are normalized the way define_component stores them. */
export function makeRegistry(
  defs: Record<string, string>,
  metas: Record<string, Partial<EmbedComponentMeta>> = {},
): ComponentRegistry {
  const map = new Map<string, ComponentMaster>();
  for (const [key, html] of Object.entries(defs)) {
    const variants = metas[key]?.variants;
    const result = validateMaster(html, key, variants);
    if (!result.ok) throw new Error(`fixture master ${key} invalid: ${result.errors.join("; ")}`);
    map.set(key, {
      key,
      html: result.master.html,
      meta: { key, name: key, ...metas[key] },
    });
  }
  return map;
}

export function btnRegistry(): ComponentRegistry {
  return makeRegistry({ btn: BTN_HTML }, { btn: { variants: { kind: ["primary", "secondary"] } } });
}

export function cardBtnRegistry(): ComponentRegistry {
  return makeRegistry(
    { btn: BTN_HTML, card: CARD_HTML },
    { btn: { variants: { kind: ["primary", "secondary"] } } },
  );
}
