import type { FlatSceneNode } from "@/types/scene";
import { reconcileHtml } from "@/lib/embedComponents";
import { BTN_HTML, makeRegistry } from "@/lib/embedComponents/__tests__/fixtures";
import { useSceneStore } from "@/store/sceneStore";
import { useVariableStore } from "@/store/variableStore";
import { resetStores } from "@/test/fixtures";
import { token } from "./fixtures";

/**
 * A seeded document for the lint exit tests: every violation kind once, next
 * to near-misses that must stay quiet. Ids say what each node is for.
 */
export const SEEDED = {
  /** Findings expected on the first run (current mode), as `nodeId -> rule`. */
  violations: {
    hardcodedColor: "hardcoded-value",
    hardcodedRadius: "hardcoded-value",
    offScale: "off-scale-value",
    lowContrast: "contrast",
    deprecatedBinding: "deprecated-token",
    literalEmbed: "embed-literal",
    staleEmbed: "component-drift",
  },
  /** Nodes that look close to a violation and must produce no finding. */
  nearMisses: ["hiddenMatch", "boundColor", "farColor", "farRadius", "goodContrast", "tokenEmbed"],
} as const;

let row = 0;
/** Every node gets its own row, so no sibling paints behind another. */
const node = (id: string, type: string, extra: Record<string, unknown> = {}): FlatSceneNode =>
  ({ id, type, name: id, x: 0, y: row++ * 50, width: 100, height: 40, ...extra }) as unknown as FlatSceneNode;

const BTN_V2 = BTN_HTML.replace("padding", "margin");

export function seedDocument(): void {
  resetStores();
  row = -1;
  useVariableStore.getState().setVariables([
    token("v-brand", "--brand", "#3366ff"),
    token("v-accent", "--accent", { light: { alias: "v-brand" }, dark: { alias: "v-brand" } }),
    token("v-surface", "--surface", { light: "#ffffff", dark: "#111111" }),
    token("v-ink", "--ink", { light: "#111111", dark: "#f5f5f5" }),
    token("v-muted", "--muted", { light: "#595959", dark: "#b0b0b0" }),
    token("v-old", "--old-brand", "#3366ff", { deprecated: { replacedBy: "v-brand" } }),
    token("v-radius", "--radius-m", "8", { type: "number", scopes: ["radius"] }),
    token("v-space", "--space-m", "16", { type: "number", scopes: ["spacing", "gap"] }),
  ]);

  const master = makeRegistry({ btn: BTN_HTML }, { btn: { variants: { kind: ["primary", "secondary"] } } }).get("btn")!;
  const consumer = reconcileHtml(`<button data-c="btn"></button>`, new Map([["btn", master]]));
  const stale = { ...master, html: makeRegistry({ btn: BTN_V2 }).get("btn")!.html };

  const nodes: FlatSceneNode[] = [
    node("screen", "frame", { width: 600, height: 900, fill: "#ffffff", fillBinding: { variableId: "v-surface" } }),
    // Violations.
    node("hardcodedColor", "rect", { fill: "#3366ff" }),
    node("hardcodedRadius", "rect", { fill: "#ff00ff", cornerRadius: 8 }),
    node("offScale", "rect", { fill: "#ff00ff", cornerRadius: 9 }),
    node("lowContrast", "text", { text: "Quiet", fontSize: 16, fill: "#aaaaaa" }),
    node("deprecatedBinding", "rect", { fill: "#3366ff", fillBinding: { variableId: "v-old" } }),
    node("literalEmbed", "embed", { htmlContent: `<div style="color:#3366ff;padding:16px">x</div>` }),
    node("staleEmbed", "embed", { htmlContent: consumer }),
    node("masterEmbed", "embed", { htmlContent: stale.html, component: { key: "btn", name: "btn", variants: { kind: ["primary", "secondary"] } } }),
    // Near misses.
    node("hiddenMatch", "rect", { fill: "#3366ff", visible: false }),
    node("boundColor", "rect", { fill: "#3366ff", fillBinding: { variableId: "v-brand" } }),
    node("farColor", "rect", { fill: "#cc3399" }),
    node("farRadius", "rect", { fill: "#cc3399", cornerRadius: 30 }),
    node("goodContrast", "text", { text: "Readable", fontSize: 16, fill: "#111111", fillBinding: { variableId: "v-ink" } }),
    node("tokenEmbed", "embed", { htmlContent: `<div style="color:var(--brand)">x</div>` }),
  ];
  const nodesById: Record<string, FlatSceneNode> = {};
  const parentById: Record<string, string | null> = {};
  nodes.forEach((n, i) => {
    nodesById[n.id] = n;
    parentById[n.id] = i === 0 ? null : "screen";
  });
  useSceneStore.setState({
    nodesById,
    parentById,
    childrenById: { screen: nodes.slice(1).map((n) => n.id) },
    rootIds: ["screen"],
    _cachedTree: null,
  });
}
