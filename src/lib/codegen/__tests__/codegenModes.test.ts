import { beforeEach, describe, expect, it } from "vitest";
import { resetStores, seedVariables } from "@/test/fixtures";
import { buildReactCode } from "../react";
import { buildTailwindCode } from "../tailwind";
import { useSceneStore } from "@/store/sceneStore";
import { useVariableStore } from "@/store/variableStore";
import { makeThemeVariable } from "@/lib/variables";
import type { FlatFrameNode, FlatSceneNode } from "@/types/scene";
import { frameNode } from "./codegenNodeFixtures";

// React and Tailwind output share one tokens-block builder; this pins that they
// agree with each other and with the canvas (a frame's own modeOverrides reach
// its descendants only, never its own bound properties).
const opts = { units: "px", remBase: 16, styleMode: "inline" } as const;
const generators = [
  ["react", (id: string, n: Record<string, FlatSceneNode>, c: Record<string, string[]>) => buildReactCode(id, n, c, opts)],
  ["tailwind", (id: string, n: Record<string, FlatSceneNode>, c: Record<string, string[]>) => buildTailwindCode(id, n, c, opts)],
] as const;

const bind = (variableId: string) => [
  { id: `p-${variableId}`, type: "solid", color: "#000000", colorBinding: { variableId } },
];
const frame = (id: string, extra: Record<string, unknown> = {}): FlatFrameNode =>
  frameNode({ id, layout: undefined, ...extra } as unknown as Partial<FlatFrameNode>);

describe.each(generators)("%s codegen tokens per mode context", (_name, generate) => {
  beforeEach(() => {
    resetStores();
    seedVariables(); // --primary: light #3366ff, dark #99bbff
    useVariableStore.getState().addVariable(
      { ...makeThemeVariable("--other", "#111111", "#eeeeee"), id: "var-other" },
    );
  });

  it("resolves tokens in an ancestor's override", () => {
    const nodes = { r: frame("r", { fills: bind("var-primary") }), outer: frame("outer", { modeOverrides: { theme: "dark" } }), kid: frame("kid") };
    useSceneStore.setState({ parentById: { r: "outer", outer: null, kid: "r" } });
    const { code } = generate("r", nodes, { r: ["kid"] }); // a child is needed for the block form
    expect(code).toContain("--primary: #99bbff;");
  });

  it("the root's own override does not recolor the root's own token, only its contents", () => {
    const root = frame("r", { fills: bind("var-primary"), modeOverrides: { theme: "dark" } });
    const kid = frame("kid", { fills: bind("var-other") });
    useSceneStore.setState({ parentById: { r: null, kid: "r" } });
    const { code, warnings } = generate("r", { r: root, kid }, { r: ["kid"] });
    expect(code).toContain("--primary: #3366ff;"); // root's own fill: parent (light) context
    expect(code).toContain("--other: #eeeeee;"); // descendants: root's dark override
    expect(warnings).toEqual([]);
  });

  it("warns when the root and its contents need one token in different modes, keeping the root's value", () => {
    const root = frame("r", { fills: bind("var-primary"), modeOverrides: { theme: "dark" } });
    const kid = frame("kid", { fills: bind("var-primary") });
    useSceneStore.setState({ parentById: { r: null, kid: "r" } });
    const { code, warnings } = generate("r", { r: root, kid }, { r: ["kid"] });
    expect(code).toContain("--primary: #3366ff;");
    expect(warnings.some((w) => /root frame/.test(w))).toBe(true);
  });

  it("warns about nested frames in other modes only when a tokens block is emitted", () => {
    const root = frame("r", { fills: bind("var-primary") });
    const inner = frame("inner", { fills: bind("var-primary"), modeOverrides: { theme: "dark" } });
    const leaf = frame("leaf", { fills: bind("var-primary") });
    useSceneStore.setState({ parentById: { r: null, inner: "r", leaf: "inner" } });
    const mixed = generate("r", { r: root, inner, leaf }, { r: ["inner"], inner: ["leaf"] });
    expect(mixed.warnings.some((w) => /different modes/.test(w))).toBe(true);

    const bare = frame("r");
    const bareInner = frame("inner", { modeOverrides: { theme: "dark" } });
    const bareLeaf = frame("leaf");
    const noTokens = generate("r", { r: bare, inner: bareInner, leaf: bareLeaf }, { r: ["inner"], inner: ["leaf"] });
    expect(noTokens.warnings).toEqual([]);
  });
});
