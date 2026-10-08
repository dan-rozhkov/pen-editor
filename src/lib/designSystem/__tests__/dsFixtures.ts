import type { Variable, VariableCollection } from "@/types/variable";
import type { EmbedComponentMeta } from "@/types/scene";
import type { ComponentMaster } from "@/lib/embedComponents";
import type { DesignSystemInput, ComponentInput } from "../types";

/** Theme (light/dark) x Brand (A/B) design system with an alias chain. */
export const COLLECTIONS: VariableCollection[] = [
  {
    id: "theme",
    name: "Theme",
    modes: [
      { id: "light", name: "Light" },
      { id: "dark", name: "Dark" },
    ],
    defaultModeId: "light",
  },
  {
    id: "brand",
    name: "Brand",
    modes: [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ],
    defaultModeId: "a",
  },
];

export const VARIABLES: Variable[] = [
  // Brand primitives.
  {
    id: "v-accent",
    name: "--accent",
    type: "color",
    collectionId: "brand",
    valuesByMode: { a: "#0000ff", b: "#ff0000" },
    value: "#0000ff",
    scopes: ["fill", "stroke"],
  },
  {
    id: "v-accent-hover",
    name: "--accent-hover",
    type: "color",
    collectionId: "brand",
    valuesByMode: { a: "#0000cc", b: "#cc0000" },
    value: "#0000cc",
    scopes: ["fill"],
  },
  // Theme semantic layer: aliases into Brand in light, literals in dark.
  {
    id: "v-primary",
    name: "--primary",
    type: "color",
    collectionId: "theme",
    valuesByMode: { light: { alias: "v-accent" }, dark: "#88aaff" },
    value: "#0000ff",
    scopes: ["fill"],
  },
  {
    id: "v-primary-hover",
    name: "--primary-hover",
    type: "color",
    collectionId: "theme",
    valuesByMode: { light: { alias: "v-accent-hover" }, dark: { alias: "v-primary" } },
    value: "#0000cc",
    scopes: ["fill"],
  },
  {
    id: "v-text",
    name: "--text",
    type: "color",
    collectionId: "theme",
    valuesByMode: { light: "#111111", dark: "#eeeeee" },
    value: "#111111",
    scopes: ["text"],
  },
  {
    id: "v-radius",
    name: "--radius",
    type: "number",
    collectionId: "theme",
    valuesByMode: { light: "8", dark: "8" },
    value: "8",
    scopes: ["radius"],
  },
  {
    id: "v-old",
    name: "--old-blue",
    type: "color",
    collectionId: "brand",
    valuesByMode: { a: "#0000aa", b: "#0000aa" },
    value: "#0000aa",
    deprecated: { since: "1.0", replacedBy: "v-accent", note: "Use accent." },
  },
];

export const BTN_HTML = `<style>
.btn { background: var(--primary); color: var(--text, #000); border-radius: calc(var(--radius) * 1px); }
.btn:hover { background: var(--primary-hover); }
@media (min-width: 600px) { .btn { border: 1px solid var(--accent); } }
@supports (display: grid) { @media (prefers-color-scheme: dark) { .btn:hover { color: var(--missing, var(--text)); } } }
</style>
<button class="btn" data-c="btn" data-v-kind="primary"><span data-c-slot="label">Go</span></button>`;

export function master(key: string, html: string, meta: Partial<EmbedComponentMeta> = {}): ComponentMaster {
  return { key, html, meta: { key, name: key.toUpperCase(), ...meta } };
}

export function componentInput(m: ComponentMaster, usage = { instances: 0, embeds: 0 }, warnings: string[] = []): ComponentInput {
  return { master: m, usage, warnings };
}

export function makeInput(overrides: Partial<DesignSystemInput> = {}): DesignSystemInput {
  return {
    variables: VARIABLES,
    collections: COLLECTIONS,
    modeContext: { theme: "light", brand: "a" },
    components: [
      componentInput(master("btn", BTN_HTML, { description: "A button", variants: { kind: ["primary", "ghost"] } }), {
        instances: 5,
        embeds: 2,
      }),
    ],
    savedScopes: [],
    ...overrides,
  };
}
