import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { serializePublicPenDocument, serializePublicPenDocumentWithWarnings } from "@/utils/publicPenExport";
import type { FrameNode, RectNode } from "@/types/scene";
import type { Variable } from "@/types/variable";

// Legacy-shaped variables on purpose: a Theme-only document must export
// byte-identically whether or not the variables carry the v2 fields.
const legacyVariables: Variable[] = [
  { id: "v-same", name: "--same", type: "color", value: "#112233" },
  { id: "v-themed", name: "--themed", type: "color", value: "#ffffff", themeValues: { light: "#ffffff", dark: "#101010" } },
  { id: "v-radius", name: "--radius-m", type: "number", value: "12", themeValues: { light: "12", dark: "16" } },
  { id: "v-label", name: "Label", type: "string", value: "Hello" },
];

const goldenNodes = [
  {
    id: "f1", type: "frame", x: 0, y: 0, width: 200, height: 100, themeOverride: "dark",
    children: [
      { id: "r1", type: "rect", x: 0, y: 0, width: 50, height: 50, fill: "#ffffff", fillBinding: { variableId: "v-themed" } } as RectNode,
    ],
  } as unknown as FrameNode,
];

const GOLDEN = join(process.cwd(), "src/utils/__tests__/fixtures/publicPenExport.theme-only.golden.json");

describe("publicPenExport golden (Theme-only document)", () => {
  it("is byte-identical to the pre-collections output, for legacy and v2-shaped variables", () => {
    const v2 = legacyVariables.map((v) => ({
      ...v,
      collectionId: "theme",
      valuesByMode: { light: v.themeValues?.light ?? v.value, dark: v.themeValues?.dark ?? v.value },
    }));
    const golden = readFileSync(GOLDEN, "utf8");
    expect(serializePublicPenDocument(goldenNodes, legacyVariables, "light")).toBe(golden);
    expect(serializePublicPenDocument(goldenNodes, v2, "light")).toBe(golden);
  });
});

describe("publicPenExport with extra collections", () => {
  const collections = [
    { id: "theme", name: "Theme", modes: [{ id: "light", name: "Light" }, { id: "dark", name: "Dark" }], defaultModeId: "light" },
    { id: "brand", name: "Brand", modes: [{ id: "m1", name: "acme" }, { id: "m2", name: "globex" }], defaultModeId: "m1" },
  ];
  const vars: Variable[] = [
    { id: "base", name: "base", type: "color", value: "#111111", collectionId: "theme", valuesByMode: { light: "#111111", dark: "#222222" } },
    { id: "accent", name: "accent", type: "color", value: "#e00000", collectionId: "brand", valuesByMode: { m1: "#e00000", m2: "#00aa00" } },
    { id: "ref", name: "ref", type: "color", value: "#111111", collectionId: "theme", valuesByMode: { light: { alias: "base" }, dark: { alias: "base" } } },
  ];

  it("adds one axis per collection and aliases export as resolved literals with a warning", () => {
    const { json, warnings } = serializePublicPenDocumentWithWarnings([], vars, "light", collections);
    const doc = JSON.parse(json);
    expect(doc.themes).toEqual({ mode: ["light", "dark"], Brand: ["acme", "globex"] });
    expect(doc.variables.accent.value).toEqual([
      { value: "#e00000", theme: { Brand: "acme" } },
      { value: "#00aa00", theme: { Brand: "globex" } },
    ]);
    expect(doc.variables.ref.value).toEqual([
      { value: "#111111", theme: { mode: "light" } },
      { value: "#222222", theme: { mode: "dark" } },
    ]);
    expect(warnings.join("\n")).toContain('"ref" aliases another variable');
  });
});
