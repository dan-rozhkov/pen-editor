import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { EmbedLayer } from "../EmbedLayer";
import { useSceneStore } from "@/store/sceneStore";
import { useVariableStore } from "@/store/variableStore";
import { useThemeStore } from "@/store/themeStore";
import { resetStores } from "@/test/fixtures";
import type { FlatSceneNode } from "@/types/scene";
import type { Variable } from "@/types/variable";

// Scope B of the embed-variables feature: editing a variable in the
// Variables tab must update an already-mounted embed's rendered value
// WITHOUT remounting its shadow DOM (a remount would reset scroll position
// and any live element-picker state). These tests assert both halves: the
// value actually changes, and the shadow root's content node stays the same
// object across the update (proof nothing was torn down and rebuilt).

function seedEmbed(htmlContent: string): void {
  useSceneStore.setState({
    nodesById: {
      e1: {
        id: "e1", type: "embed", name: "Code", x: 0, y: 0,
        width: 100, height: 80, htmlContent,
      } as unknown as FlatSceneNode,
    },
    parentById: { e1: null },
    childrenById: {},
    rootIds: ["e1"],

    _cachedTree: null,
  });
}

function seedVariable(): void {
  useVariableStore.setState({
    variables: [
      {
        id: "v1",
        name: "--brand",
        type: "color",
        value: "#00ff00",
        themeValues: { light: "#00ff00", dark: "#003300" },
      } as unknown as Variable,
    ],
  });
}

describe("<EmbedLayer /> live variable updates", () => {
  beforeEach(() => { resetStores(); });
  afterEach(() => cleanup());

  it("applies a newly-added variable to the already-mounted embed root", () => {
    seedEmbed("<div id='card'>hi</div>");
    const { container } = render(<EmbedLayer />);
    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const root = host.shadowRoot!.firstElementChild as HTMLElement;

    expect(root.style.getPropertyValue("--brand")).toBe("");

    act(() => { seedVariable(); });

    expect(root.style.getPropertyValue("--brand")).toBe("#00ff00");
    // Same content node — the shadow DOM was updated in place, not remounted.
    expect(host.shadowRoot!.firstElementChild).toBe(root);
  });

  it("updates the value in place when an existing variable changes", () => {
    seedVariable();
    seedEmbed("<div id='card'>hi</div>");
    const { container } = render(<EmbedLayer />);
    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const root = host.shadowRoot!.firstElementChild as HTMLElement;

    expect(root.style.getPropertyValue("--brand")).toBe("#00ff00");

    act(() => {
      useVariableStore.getState().updateVariableThemeValue("v1", "light", "#ff00ff");
    });

    expect(root.style.getPropertyValue("--brand")).toBe("#ff00ff");
    expect(host.shadowRoot!.firstElementChild).toBe(root);
  });

  // The full authored-:root-fallback path (delete a variable, land on the
  // embed's OWN `:root` declaration rather than nothing) is covered directly
  // against `applyEditorVariableProperties`/`mountHtmlWithBodyStyles` in
  // `embedHtmlUtils.editorVariables.test.ts`, not here: `sanitizeEmbedHtml`
  // goes through DOMPurify, whose tag-stripping (and, incidentally here,
  // `<style>` tag preservation) cannot be exercised under this repo's
  // happy-dom Vitest environment at all — see `sanitizeEmbedHtml.ts`'s own
  // "NOTE for future test authors". This test instead only asserts the half
  // that's safe to check at the component level: deleting the variable
  // removes the property when the embed has nothing of its own to fall
  // back to, rather than leaving the deleted editor value dangling.
  it("removes the property on delete when the embed has no authored fallback", () => {
    seedVariable();
    seedEmbed("<div id='card'>hi</div>");
    const { container } = render(<EmbedLayer />);
    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const root = host.shadowRoot!.firstElementChild as HTMLElement;

    // Editor value wins at mount.
    expect(root.style.getPropertyValue("--brand")).toBe("#00ff00");

    act(() => { useVariableStore.getState().deleteVariable("v1"); });

    expect(root.style.getPropertyValue("--brand")).toBe("");
    expect(host.shadowRoot!.firstElementChild).toBe(root);
  });
});

describe("<EmbedLayer /> live mode-context updates", () => {
  beforeEach(() => { resetStores(); });
  afterEach(() => cleanup());

  const frame = (id: string, extra: Record<string, unknown> = {}) =>
    ({ id, type: "frame", name: id, x: 0, y: 0, width: 400, height: 400, ...extra }) as unknown as FlatSceneNode;
  const embed = (id: string) =>
    ({ id, type: "embed", name: id, x: 0, y: 0, width: 100, height: 80, htmlContent: "<div>hi</div>" }) as unknown as FlatSceneNode;

  function seedTwoEmbeds(): void {
    useSceneStore.setState({
      nodesById: { fa: frame("fa"), fb: frame("fb"), ea: embed("ea"), eb: embed("eb") },
      parentById: { fa: null, fb: null, ea: "fa", eb: "fb" },
      childrenById: { fa: ["ea"], fb: ["eb"] },
      rootIds: ["fa", "fb"],
      _cachedTree: null,
    });
  }

  // Custom-property writes only: `position()` also sets `transform` on layout.
  const customPropertyWrites = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.filter((c) => String(c[0]).startsWith("--")).length;

  const rootOf = (container: HTMLElement, id: string) =>
    container.querySelector<HTMLElement>(`[data-embed-id="${id}"]`)!.shadowRoot!.firstElementChild as HTMLElement;

  it("re-applies properties in place when the document-level mode changes", () => {
    seedVariable(); // --brand light #00ff00, dark #003300
    seedTwoEmbeds();
    const { container } = render(<EmbedLayer />);
    const root = rootOf(container, "ea");
    expect(root.style.getPropertyValue("--brand")).toBe("#00ff00");

    act(() => { useThemeStore.getState().setModeContext({ theme: "dark" }); });

    expect(root.style.getPropertyValue("--brand")).toBe("#003300");
    expect(rootOf(container, "ea")).toBe(root); // updated in place, not remounted
    expect(rootOf(container, "eb").style.getPropertyValue("--brand")).toBe("#003300");
  });

  it("a frame override change re-applies for its own embed child only", () => {
    seedVariable();
    seedTwoEmbeds();
    const { container } = render(<EmbedLayer />);
    const rootA = rootOf(container, "ea");
    const rootB = rootOf(container, "eb");
    const setPropertyA = vi.spyOn(rootA.style, "setProperty");
    const setPropertyB = vi.spyOn(rootB.style, "setProperty");

    act(() => {
      useSceneStore.setState((s) => ({
        nodesById: { ...s.nodesById, fa: frame("fa", { modeOverrides: { theme: "dark" } }) },
      }));
    });

    expect(rootA.style.getPropertyValue("--brand")).toBe("#003300");
    expect(rootB.style.getPropertyValue("--brand")).toBe("#00ff00");
    expect(customPropertyWrites(setPropertyA)).toBeGreaterThan(0);
    expect(customPropertyWrites(setPropertyB)).toBe(0);
  });

  it("an unrelated scene edit leaves the embed untouched", () => {
    seedVariable();
    seedTwoEmbeds();
    const { container } = render(<EmbedLayer />);
    const rootA = rootOf(container, "ea");
    const setPropertyA = vi.spyOn(rootA.style, "setProperty");
    act(() => {
      useSceneStore.setState((s) => ({ nodesById: { ...s.nodesById, fb: frame("fb", { fill: "#fff" }) } }));
    });
    expect(customPropertyWrites(setPropertyA)).toBe(0);
  });
});
