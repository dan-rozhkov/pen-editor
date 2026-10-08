import type { Snapshot, SnapshotComponent, SnapshotVariable } from "@/lib/designSystem";

export const THEME = {
  id: "theme",
  name: "Theme",
  modes: [
    { id: "light", name: "Light" },
    { id: "dark", name: "Dark" },
  ],
  defaultModeId: "light",
};

export function colorVar(id: string, name: string, light: string, dark = light, extra: Partial<SnapshotVariable> = {}): SnapshotVariable {
  return { id, name, type: "color", collectionId: "theme", valuesByMode: { light, dark }, ...extra };
}

export function button(extra: Partial<SnapshotComponent> = {}): SnapshotComponent {
  return {
    key: "button",
    html: '<button data-c="button"><span data-c-slot="label">Go</span></button>',
    rev: "r1",
    meta: { name: "Button", variants: { size: ["sm", "md"] } },
    ...extra,
  };
}

export function snap(parts: Partial<Snapshot> = {}): Snapshot {
  return {
    schemaVersion: 1,
    collections: [THEME],
    variables: [colorVar("var_brand", "Brand", "#0055ff", "#4488ff"), colorVar("var_bg", "Background", "#ffffff", "#111111")],
    components: [button()],
    ...parts,
  };
}
