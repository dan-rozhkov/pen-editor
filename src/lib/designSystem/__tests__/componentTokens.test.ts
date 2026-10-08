import { describe, it, expect, vi } from "vitest";
import * as embedHtml from "@/lib/embedHtmlDocument";
import { buildVariableIndex } from "@/lib/variables";
import { parseMaster } from "@/lib/embedComponents";
import { assertDefined } from "@/test/assertions";
import { componentTokens } from "../componentTokens";
import { BTN_HTML, COLLECTIONS, VARIABLES, master } from "./dsFixtures";

const index = buildVariableIndex(VARIABLES, COLLECTIONS);

function usesFor(html: string, ctx: Record<string, string>, max?: number) {
  const m = master("btn", html);
  const parsed = parseMaster(m);
  assertDefined(parsed);
  return componentTokens(parsed, VARIABLES, index, ctx, max);
}

const find = (uses: ReturnType<typeof usesFor>, token: string, selectorPart = "") =>
  uses.find((u) => u.token === token && u.selector.includes(selectorPart));

describe("componentTokens", () => {
  it("finds var() uses in base rules, :hover and nested at-rules", () => {
    const uses = usesFor(BTN_HTML, { theme: "light", brand: "a" });
    expect(find(uses, "--primary")?.property).toBe("background");
    expect(find(uses, "--primary-hover", ":hover")?.property).toBe("background");
    expect(find(uses, "--accent", "@media (min-width: 600px)")?.property).toBe("border");
    expect(find(uses, "--text", "@supports (display: grid) @media (prefers-color-scheme: dark)")).toBeDefined();
  });

  it("finds a var() inside calc() and inside a fallback", () => {
    const uses = usesFor(BTN_HTML, { theme: "light", brand: "a" });
    expect(find(uses, "--radius")?.property).toBe("border-radius");
    expect(find(uses, "--missing")).toBeDefined();
  });

  it("resolves the master variable, not the CSS fallback", () => {
    const uses = usesFor(BTN_HTML, { theme: "light", brand: "a" });
    const base = uses.filter((u) => u.token === "--text" && !u.selector.startsWith("@"));
    expect(base.map((u) => u.resolved)).toEqual(["#111111"]);
  });

  it("resolves an unknown variable through its fallback, or null without one", () => {
    const uses = usesFor(BTN_HTML, { theme: "dark", brand: "a" });
    expect(find(uses, "--missing")?.resolved).toBe("#eeeeee");
    const bare = usesFor(`<div data-c="btn" style="color: var(--nope)"></div>`, {});
    expect(bare[0].resolved).toBeNull();
  });

  it("resolves the hover token per mode context", () => {
    const hover = (ctx: Record<string, string>) =>
      find(usesFor(BTN_HTML, ctx), "--primary-hover", ":hover")?.resolved;
    expect(hover({ theme: "light", brand: "a" })).toBe("#0000cc");
    expect(hover({ theme: "light", brand: "b" })).toBe("#cc0000");
    expect(hover({ theme: "dark", brand: "b" })).toBe("#88aaff");
  });

  it("reads inline style attributes on the root and on children", () => {
    const uses = usesFor(
      `<div data-c="btn" style="background: var(--primary)"><span style="color:var(--text)">x</span></div>`,
      { theme: "light", brand: "a" },
    );
    expect(uses.map((u) => [u.selector, u.property, u.token])).toEqual([
      ['[data-c="btn"]', "background", "--primary"],
      ["span[style]", "color", "--text"],
    ]);
  });

  it("lists a use once per selector, property and token", () => {
    const uses = usesFor(
      `<style>.a{border:1px solid var(--text);color:var(--text)} .a{border:2px solid var(--text)} .b{border:1px solid var(--text)}</style><div data-c="btn" class="a"></div>`,
      {},
    );
    expect(uses.filter((u) => u.property === "border")).toHaveLength(2); // .a once, .b once
    expect(uses.filter((u) => u.property === "color")).toHaveLength(1);
  });

  it("caps the list and keeps document order", () => {
    const rules = Array.from({ length: 10 }, (_, i) => `.r${i}{color:var(--text)}`).join("");
    const uses = usesFor(`<style>${rules}</style><div data-c="btn"></div>`, {}, 3);
    expect(uses.map((u) => u.selector)).toEqual([
      '[data-c="btn"].r0, [data-c="btn"] .r0',
      '[data-c="btn"].r1, [data-c="btn"] .r1',
      '[data-c="btn"].r2, [data-c="btn"] .r2',
    ]);
  });
});

describe("componentTokens caching", () => {
  it("scans the inline styles of one master once", () => {
    const spy = vi.spyOn(embedHtml, "parseEmbedHtml");
    const m = master("cache-key", `<div data-c="cache-key" style="color: var(--text)">x</div>`);
    const parsed = parseMaster(m);
    assertDefined(parsed);
    componentTokens(parsed, VARIABLES, index, { theme: "light", brand: "a" });
    const afterFirst = spy.mock.calls.length;
    componentTokens(parsed, VARIABLES, index, { theme: "dark", brand: "a" });
    expect(spy.mock.calls.length).toBe(afterFirst);
    spy.mockRestore();
  });
});
