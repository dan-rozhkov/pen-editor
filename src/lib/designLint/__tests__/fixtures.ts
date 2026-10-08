import type { FlatSceneNode } from "@/types/scene";
import type { Variable, VariableCollection, VariableModeValue } from "@/types/variable";
import { makeThemeCollection } from "@/lib/variables";
import { v2Var } from "@/lib/variables/__tests__/fixtures";
import type { ComponentRegistry } from "@/lib/embedComponents";
import { runDesignLint } from "..";
import type { Finding, LintEmbed, LintInput, LintOptions, LintResult, LintRuleId, Rect } from "../types";

/** A node spec: any flat node field plus nested children. Geometry defaults to 0,0 100x100. */
export interface N {
  id: string;
  type: FlatSceneNode["type"];
  children?: N[];
  [key: string]: unknown;
}

export const frame = (id: string, props: Omit<Partial<N>, "id" | "type"> = {}): N => ({ id, type: "frame", ...props });
export const rect = (id: string, props: Omit<Partial<N>, "id" | "type"> = {}): N => ({ id, type: "rect", ...props });
export const text = (id: string, props: Omit<Partial<N>, "id" | "type"> = {}): N => ({
  id,
  type: "text",
  text: "Hello",
  ...props,
});
export const embed = (id: string, htmlContent: string, props: Omit<Partial<N>, "id" | "type"> = {}): N => ({
  id,
  type: "embed",
  htmlContent,
  ...props,
});

/** A named variable in the Theme collection (`valuesByMode` keyed light/dark). */
export function token(
  id: string,
  name: string,
  values: Record<string, VariableModeValue> | string,
  extra: Partial<Variable> = {},
): Variable {
  const valuesByMode = typeof values === "string" ? { light: values, dark: values } : values;
  return { ...v2Var(id, "theme", valuesByMode, extra.type ?? "color"), name, ...extra };
}

const collect = (n: N, parent: string | null, ox: number, oy: number, acc: Flat) => {
  const { children, ...rest } = n;
  const node = { x: 0, y: 0, width: 100, height: 100, ...rest } as unknown as FlatSceneNode;
  acc.nodesById[n.id] = node;
  acc.parentById[n.id] = parent;
  const abs: Rect = { x: ox + node.x, y: oy + node.y, width: node.width, height: node.height };
  acc.rects[n.id] = abs;
  if (children) {
    acc.childrenById[n.id] = children.map((c) => c.id);
    for (const c of children) collect(c, n.id, abs.x, abs.y, acc);
  }
};

interface Flat {
  nodesById: Record<string, FlatSceneNode>;
  parentById: Record<string, string | null>;
  childrenById: Record<string, string[]>;
  rects: Record<string, Rect>;
}

export function lintInput(roots: N[], extra: Partial<LintInput> = {}): LintInput {
  const acc: Flat = { nodesById: {}, parentById: {}, childrenById: {}, rects: {} };
  for (const r of roots) collect(r, null, 0, 0, acc);
  const embeds: LintEmbed[] = Object.values(acc.nodesById)
    .filter((n) => n.type === "embed")
    .map((n) => {
      const e = n as unknown as { id: string; htmlContent: string; component?: { key: string } };
      return { nodeId: e.id, pageId: "p1", html: e.htmlContent, masterKey: e.component?.key };
    });
  return {
    pageId: "p1",
    ...acc,
    rootIds: roots.map((r) => r.id),
    pageBackground: "#ffffff",
    variables: [],
    collections: [makeThemeCollection()] as VariableCollection[],
    baseModes: { theme: "light" },
    registry: new Map() as ComponentRegistry,
    duplicateMasters: new Map(),
    embeds,
    ...extra,
  };
}

export function lint(roots: N[], extra: Partial<LintInput> = {}, opts: LintOptions = {}): LintResult {
  return runDesignLint(lintInput(roots, extra), opts);
}

/** Findings of one rule, in output order. */
export function byRule(result: LintResult, rule: LintRuleId): Finding[] {
  return result.findings.filter((f) => f.rule === rule);
}

export const solid = (color: string, extra: Record<string, unknown> = {}) => ({
  id: `p-${color}`,
  type: "solid",
  color,
  ...extra,
});
