import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { ComponentsPanel } from "../ComponentsPanel";
import { ReadOnlyContext } from "@/hooks/useReadOnly";
import { defineComponent } from "@/lib/tools/components";
import { finalizeEmbedHtml } from "@/lib/embedComponents";
import { BTN_HTML, CARD_HTML, makeRegistry } from "@/lib/embedComponents/__tests__/fixtures";
import { selectComponentRegistry } from "@/store/componentRegistry";
import { usePageStore } from "@/store/pageStore";
import { useSelectionStore } from "@/store/selectionStore";
import { activeHtml, resetWorld, seedEmbed, seedInactivePage } from "@/test/componentFixtures";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

async function defineBtn(extra: Record<string, unknown> = {}) {
  await defineComponent({
    key: "btn",
    name: "Button",
    html: BTN_HTML,
    variants: { kind: ["primary", "secondary"] },
    ...extra,
  });
}

function expand(html: string): string {
  const out = finalizeEmbedHtml(html, { registry: selectComponentRegistry() });
  return out.ok ? out.html : "";
}

const row = (key: string) => screen.getByTestId(`component-row-${key}`);

beforeEach(() => {
  resetWorld();
  vi.clearAllMocks();
});
afterEach(() => cleanup());

describe("<ComponentsPanel />", () => {
  it("shows an empty state without components", () => {
    render(<ComponentsPanel />);
    expect(screen.getByText(/No components yet/)).toBeTruthy();
  });

  it("lists components with status badge, usage count and description", async () => {
    await defineBtn({ status: "stable", description: "Primary action" });
    seedEmbed("s1", expand("<main><c-btn>A</c-btn><c-btn>B</c-btn></main>"));
    seedEmbed("s2", expand("<main><c-btn>C</c-btn></main>"));
    render(<ComponentsPanel />);
    const r = within(row("btn"));
    expect(r.getByText("Button")).toBeTruthy();
    expect(r.getByText("Stable")).toBeTruthy();
    expect(r.getByText("Primary action")).toBeTruthy();
    expect(r.getByText("3 uses in 2 screens")).toBeTruthy();
  });

  it("filters by name, key and description", async () => {
    await defineBtn();
    await defineComponent({ key: "card", name: "Card", html: CARD_HTML, description: "Content box" });
    render(<ComponentsPanel />);
    const search = screen.getByRole("textbox", { name: "Search components" });
    fireEvent.change(search, { target: { value: "content" } });
    expect(screen.queryByTestId("component-row-btn")).toBeNull();
    expect(screen.getByTestId("component-row-card")).toBeTruthy();
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText("No components found.")).toBeTruthy();
  });

  it("shows library badge and read-only details for a library master", async () => {
    const btn = makeRegistry({ btn: BTN_HTML }, { btn: { name: "Button" } }).get("btn")!;
    seedEmbed("libbtn", btn.html, { component: { ...btn.meta, library: { id: "lib1", version: "1.0.0" } } });
    render(<ComponentsPanel />);
    expect(within(row("btn")).getByText(/Library:/)).toBeTruthy();
    fireEvent.click(within(row("btn")).getByRole("button", { name: /Details/ }));
    expect(within(row("btn")).getByText(/Edit it in the library document/)).toBeTruthy();
    expect(within(row("btn")).queryByRole("form")).toBeNull();
  });

  it("warns about duplicate keys", async () => {
    await defineBtn();
    const master = selectComponentRegistry().get("btn")!;
    seedEmbed("copy", master.html, { component: master.meta });
    render(<ComponentsPanel />);
    expect(within(row("btn")).getByText(/Duplicate key: 1 more master uses it/)).toBeTruthy();
  });

  it("goes to a master on another page: switches page, selects it", async () => {
    await defineBtn();
    const masterPage = selectComponentRegistry().get("btn")!.pageId!;
    usePageStore.getState().switchToPage("p1");
    expect(usePageStore.getState().activePageId).toBe("p1");
    render(<ComponentsPanel />);
    fireEvent.click(within(row("btn")).getByRole("button", { name: "Go to master, Button" }));
    expect(usePageStore.getState().activePageId).toBe(masterPage);
    expect(useSelectionStore.getState().selectedIds).toEqual([selectComponentRegistry().get("btn")!.nodeId]);
  });

  describe("insert instance", () => {
    it("is disabled without a selected embed and in read-only mode", async () => {
      await defineBtn();
      seedEmbed("s1", "<main></main>");
      usePageStore.getState().switchToPage("p1");
      const { unmount } = render(<ComponentsPanel />);
      const button = () => within(row("btn")).getByRole("button", { name: "Insert instance, Button" });
      expect((button() as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByText("Select a screen to insert an instance.")).toBeTruthy();
      act(() => useSelectionStore.getState().setSelectedIds(["s1"]));
      await waitFor(() => expect((button() as HTMLButtonElement).disabled).toBe(false));
      unmount();
      render(
        <ReadOnlyContext.Provider value>
          <ComponentsPanel />
        </ReadOnlyContext.Provider>,
      );
      expect((button() as HTMLButtonElement).disabled).toBe(true);
    });

    it("writes the instance into the selected embed", async () => {
      await defineBtn();
      seedEmbed("s1", "<main><h1>Home</h1></main>");
      usePageStore.getState().switchToPage("p1");
      useSelectionStore.getState().setSelectedIds(["s1"]);
      render(<ComponentsPanel />);
      fireEvent.click(within(row("btn")).getByRole("button", { name: "Insert instance, Button" }));
      await waitFor(() => expect(toast.success).toHaveBeenCalled());
      expect(activeHtml("s1")).toMatch(/<main><h1>Home<\/h1><\/main><button data-c="btn"/);
      expect(activeHtml("s1")).toContain('<style data-c-style="btn">');
      await waitFor(() => expect(within(row("btn")).getByText("1 use in 1 screen")).toBeTruthy());
    });

    it("is disabled when the selection is a component master", async () => {
      await defineBtn();
      const master = selectComponentRegistry().get("btn")!;
      usePageStore.getState().switchToPage(master.pageId!);
      useSelectionStore.getState().setSelectedIds([master.nodeId!]);
      render(<ComponentsPanel />);
      expect(
        (within(row("btn")).getByRole("button", { name: "Insert instance, Button" }) as HTMLButtonElement).disabled,
      ).toBe(true);
    });
  });

  it("shows nested use in other components separately from screen uses", async () => {
    await defineBtn();
    await defineComponent({
      key: "bar",
      name: "Bar",
      html: `<style>.x{gap:4px}</style><div data-c="bar"><c-btn>Ok</c-btn></div>`,
    });
    seedEmbed("s1", expand("<main><c-btn>A</c-btn></main>"));
    render(<ComponentsPanel />);
    expect(within(row("btn")).getByText("1 use in 1 screen; used in 1 component")).toBeTruthy();
    expect(within(row("bar")).getByText("Not used yet")).toBeTruthy();
  });

  describe("edit details", () => {
    it("does not overwrite a field changed elsewhere while the form is open", async () => {
      await defineBtn({ description: "Old" });
      render(<ComponentsPanel />);
      const r = within(row("btn"));
      fireEvent.click(r.getByRole("button", { name: "Edit details, Button" }));
      await defineBtn({ description: "Changed by the agent" });
      expect(selectComponentRegistry().get("btn")?.meta.description).toBe("Changed by the agent");
      fireEvent.change(r.getByLabelText("Name"), { target: { value: "Renamed" } });
      fireEvent.click(r.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(selectComponentRegistry().get("btn")?.meta.name).toBe("Renamed"));
      expect(selectComponentRegistry().get("btn")?.meta.description).toBe("Changed by the agent");
    });

    it("saves name, description, status and deprecation through define_component", async () => {
      await defineBtn();
      await defineComponent({ key: "btn2", name: "Button 2", html: BTN_HTML.replaceAll('"btn"', '"btn2"') });
      seedInactivePage("p2", "Other", {});
      render(<ComponentsPanel />);
      const r = within(row("btn"));
      const toggle = r.getByRole("button", { name: "Edit details, Button" });
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      fireEvent.click(toggle);
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      fireEvent.change(r.getByLabelText("Name"), { target: { value: "Action button" } });
      fireEvent.change(r.getByLabelText("Description"), { target: { value: "Does things" } });
      fireEvent.change(r.getByLabelText("Status"), { target: { value: "deprecated" } });
      fireEvent.change(r.getByLabelText("Replaced by"), { target: { value: "btn2" } });
      fireEvent.change(r.getByLabelText("Deprecation note"), { target: { value: "Old style" } });
      fireEvent.click(r.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(selectComponentRegistry().get("btn")?.meta.name).toBe("Action button"));
      expect(selectComponentRegistry().get("btn")?.meta).toMatchObject({
        description: "Does things",
        status: "deprecated",
        deprecated: { replacedBy: "btn2", note: "Old style" },
      });
      await waitFor(() => expect(within(row("btn")).getByText("Deprecated")).toBeTruthy());
      expect(within(row("btn")).getByText(/Use btn2 instead/)).toBeTruthy();
    });

    it("clears status and deprecation when the status is reset", async () => {
      await defineBtn({ status: "deprecated" });
      render(<ComponentsPanel />);
      const r = within(row("btn"));
      fireEvent.click(r.getByRole("button", { name: "Edit details, Button" }));
      fireEvent.change(r.getByLabelText("Status"), { target: { value: "" } });
      fireEvent.click(r.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(selectComponentRegistry().get("btn")?.meta.status).toBeUndefined());
      expect(selectComponentRegistry().get("btn")?.meta.deprecated).toBeUndefined();
    });

    it("shows an error for an empty name and keeps the form open", async () => {
      await defineBtn();
      render(<ComponentsPanel />);
      const r = within(row("btn"));
      fireEvent.click(r.getByRole("button", { name: "Edit details, Button" }));
      fireEvent.change(r.getByLabelText("Name"), { target: { value: " " } });
      fireEvent.click(r.getByRole("button", { name: "Save" }));
      expect((await r.findByRole("alert")).textContent).toBe("Name is required.");
    });
  });
});
