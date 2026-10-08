import { describe, expect, it } from "vitest";
import type { FlatSceneNode } from "@/types/scene";
import type { ComponentMaster, ComponentRegistry } from "@/lib/embedComponents";
import { lintInput, rect, token } from "@/lib/designLint/__tests__/fixtures";
import { computeUsageReport } from "../computeReport";
import type { UsageInput } from "../types";

const node = (id: string, type: string, extra: Record<string, unknown> = {}) =>
  ({ id, type, x: 0, y: 0, width: 100, height: 100, ...extra }) as unknown as FlatSceneNode;

const binding = (variableId: string) => ({ variableId });

const master = (key: string, library?: { id: string; version: string }): ComponentMaster =>
  ({ key, meta: { key, name: key, ...(library ? { library } : {}) }, html: "" }) as ComponentMaster;

const registry = (...masters: ComponentMaster[]): ComponentRegistry => new Map(masters.map((m) => [m.key, m]));

const libColor = token("v-lib-c", "--lib-c", "#3366ff", { libraryId: "lib1" });
const libRadius = token("v-lib-r", "--lib-r", "8", { type: "number", libraryId: "lib1" });
const libUnused = token("v-lib-u", "--lib-u", "#000000", { libraryId: "lib1" });
const localColor = token("v-local", "--local", "#ff0000");

const EMBED_HTML = `<html><head>
<style>.a{color:var(--lib-c, #000);background:#fff;border-color:red} .btn #abc{margin:0}</style>
<style data-c-style="btn">.m{color:#abcdef}</style>
<style data-d-style="btn-1">.x{color:#123456}</style>
</head><body>
<div data-c="btn"></div><div data-c="btn"></div><div data-c="local"></div><div data-c="ghost"></div>
<div data-d="btn-1"></div><div data-d="btn-2"></div><div data-d="mine-1"></div>
<p style="color: rgb(1, 2, 3); width: var(--nope); background: oklch(0.5 0.1 20)">SECRET-USER-TEXT</p>
</body></html>`;

function fixture(extra: Partial<UsageInput> = {}): UsageInput {
  return {
    pages: [
      {
        id: "p1",
        nodesById: {
          r1: node("r1", "rect", {
            fill: "#3366ff",
            fillBinding: binding("v-lib-c"),
            cornerRadius: 8,
            numberBindings: { cornerRadius: binding("v-lib-r") },
          }),
          r2: node("r2", "rect", { fill: "#112233", cornerRadius: 4 }),
          r3: node("r3", "rect", { fill: "#ff0000", fillBinding: binding("v-local") }),
          r4: node("r4", "rect", { fills: [{ id: "p", type: "solid", color: "#ffffff", styleId: "s1" }] }),
          hf: node("hf", "frame", { visible: false }),
          hc: node("hc", "rect", { fill: "#112233" }),
          e1: node("e1", "embed", { htmlContent: EMBED_HTML }),
          // Masters are definitions, not uses.
          m1: node("m1", "embed", { htmlContent: '<style>.m{color:blue}</style><style data-c-style="btn">.q{color:#fff}</style><div data-c="btn"></div>', component: { key: "btn", name: "btn" } }),
        },
        rootIds: ["r1", "r2", "r3", "r4", "hf", "e1", "m1"],
        childrenById: { hf: ["hc"] },
      },
    ],
    variables: [libColor, libRadius, libUnused, localColor],
    registry: registry(
      master("btn", { id: "lib1", version: "1.2.0" }),
      master("card", { id: "lib1", version: "1.2.0" }),
      master("local"),
    ),
    ...extra,
  };
}

describe("computeUsageReport", () => {
  it("counts token coverage over scene nodes", () => {
    const r = computeUsageReport(fixture());
    expect(r.schemaVersion).toBe(1);
    expect(r.tokens).toMatchObject({ bindable: 6, bound: 4, boundToLibrary: 2, styled: 1, literal: 2, cssNameCollisions: 0 });
    // The embed's var(--lib-c) counts as a second use of the library color.
    expect(r.tokens.use).toEqual({ "v-lib-c": 2, "v-lib-r": 1 });
    expect(r.nodes).toBe(6); // the hidden frame hides its child
    expect(r.truncated).toBe(false);
  });

  it("counts embed CSS var() references against literals, ignoring var() fallbacks", () => {
    const r = computeUsageReport(fixture());
    expect(r.tokens.embed).toEqual({ varRefs: 1, unknownVarRefs: 1, literals: 5 });
    expect(r.embeds).toBe(2);
  });

  it("counts component instances, detached copies and library keys", () => {
    const r = computeUsageReport(fixture());
    expect(r.components).toEqual({
      instances: 3,
      libraryInstances: 2,
      detached: 3,
      use: { btn: 2 },
      detachedByKey: { btn: 2 },
    });
  });

  it("breaks usage down per library, with unused items", () => {
    const r = computeUsageReport(fixture());
    expect(r.libraries).toEqual([
      {
        libraryId: "lib1",
        version: "1.2.0",
        reportUsage: false,
        tokens: { total: 3, used: 2, unused: 1 },
        components: { total: 2, used: 1, unused: 1 },
        unusedTokenIds: ["v-lib-u"],
        unusedComponentKeys: ["card"],
      },
    ]);
  });

  it("takes the version from the pin and lists pinned libraries with no usage", () => {
    const r = computeUsageReport(
      fixture({
        pins: [
          { id: "lib1", name: "L1", version: "2.0.0", reportUsage: true },
          { id: "lib2", name: "L2", version: "0.1.0" },
        ],
      }),
    );
    expect(r.libraries.map((l) => [l.libraryId, l.version, l.reportUsage])).toEqual([
      ["lib1", "2.0.0", true],
      ["lib2", "0.1.0", false],
    ]);
    expect(r.libraries[1].tokens.total).toBe(0);
  });

  it("handles a document with no library", () => {
    const r = computeUsageReport(
      fixture({ variables: [localColor], registry: registry(master("local")) }),
    );
    expect(r.libraries).toEqual([]);
    expect(r.tokens.boundToLibrary).toBe(0);
    expect(r.tokens.use).toEqual({});
    expect(r.components.libraryInstances).toBe(0);
  });

  it("returns lint: null without a lint input and counts per rule with one", () => {
    expect(computeUsageReport(fixture()).lint).toBeNull();
    const withLint = computeUsageReport(
      fixture({ lint: lintInput([rect("l1", { fill: "#3366ff" })], { variables: [libColor] }) }),
    );
    expect(withLint.lint?.["hardcoded-value"]).toBe(1);
    expect(withLint.lint?.contrast).toBe(0);
  });

  it("prefers the library token when two tokens share a CSS name", () => {
    const clash = token("v-clash", "--lib-c", "#000000");
    const r = computeUsageReport(fixture({ variables: [clash, libColor, libRadius, libUnused] }));
    expect(r.tokens.cssNameCollisions).toBe(1);
    expect(r.tokens.use["v-lib-c"]).toBe(2);
    expect(r.tokens.embed.varRefs).toBe(1);
  });

  it("does not spend the node cap on hidden nodes", () => {
    const r = computeUsageReport(fixture(), { maxNodes: 6 });
    expect(r.nodes).toBe(6);
    expect(r.truncated).toBe(false);
  });

  it("stops at the node cap and says so", () => {
    const r = computeUsageReport(fixture(), { maxNodes: 2 });
    expect(r.nodes).toBe(2);
    expect(r.truncated).toBe(true);
  });

  it("stops at the embed cap and the time budget", () => {
    expect(computeUsageReport(fixture(), { maxEmbeds: 0 }).truncated).toBe(true);
    let t = 0;
    const r = computeUsageReport(fixture(), { now: () => (t += 10_000) });
    expect(r.truncated).toBe(true);
  });

  it("cuts oversized embeds and flags the report", () => {
    const r = computeUsageReport(fixture(), { maxEmbedChars: 50 });
    expect(r.truncated).toBe(true);
  });

  it("caps the unused lists", () => {
    const many = Array.from({ length: 80 }, (_, i) => token(`v-${i}`, `--t${i}`, "#000000", { libraryId: "lib1" }));
    const r = computeUsageReport(fixture({ variables: many }));
    expect(r.libraries[0].tokens.unused).toBe(80);
    expect(r.libraries[0].unusedTokenIds).toHaveLength(50);
  });

  it("carries only counts, ids and keys: no user text", () => {
    const json = JSON.stringify(computeUsageReport(fixture()));
    expect(json).not.toContain("SECRET-USER-TEXT");
    expect(json).not.toContain("#112233");
    expect(json).not.toContain("mine");
  });
});
