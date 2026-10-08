import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { VariablesPanelContent } from "../VariablesPanel";
import { useVariableStore } from "@/store/variableStore";
import { makeThemeVariable } from "@/lib/variables";
import { resetStores, seedVariables, seedVariablesV2 } from "@/test/fixtures";

vi.mock("@/components/ui/ColorPicker", () => ({
  CustomColorPicker: () => null,
}));

const store = () => useVariableStore.getState();
const variable = (id: string) => store().variables.find((v) => v.id === id);

function clickMenuItem(trigger: string, item: string) {
  fireEvent.click(screen.getByLabelText(trigger));
  fireEvent.click(screen.getByText(item));
}

/** Adds a collection through the UI; the new tab becomes active. */
function addCollectionViaUi() {
  fireEvent.click(screen.getByLabelText("Add collection"));
  return store().collections[store().collections.length - 1];
}

describe("<VariablesPanelContent /> collections and modes", () => {
  beforeEach(() => resetStores());
  afterEach(() => cleanup());

  it("renders a legacy document as a Theme tab with Light and Dark columns", () => {
    seedVariables();
    render(<VariablesPanelContent />);

    expect(screen.getByRole("tab", { name: "Theme" })).toBeTruthy();
    expect(screen.getByText("Light")).toBeTruthy();
    expect(screen.getByText("Dark")).toBeTruthy();
    expect(screen.getByLabelText("Default mode")).toBeTruthy();
  });

  it("adds a collection, switches to its tab and fills new variables for every mode", () => {
    render(<VariablesPanelContent />);
    const created = addCollectionViaUi();

    expect(created.name).toBe("Collection 2");
    expect(screen.getByRole("tab", { name: "Collection 2" })).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Add mode"));
    fireEvent.click(screen.getByLabelText("Add variable"));
    fireEvent.click(screen.getByText("Number"));

    const added = store().variables[0];
    expect(added.collectionId).toBe(created.id);
    expect(Object.keys(added.valuesByMode ?? {})).toHaveLength(2);
  });

  it("disables Add mode for the Theme collection, with an explanation, and the store refuses too", () => {
    seedVariables();
    render(<VariablesPanelContent />);
    const button = screen.getByLabelText("Add mode") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("title")).toMatch(/fixed/i);
    fireEvent.click(button);
    expect(store().collections.find((c) => c.id === "theme")?.modes).toHaveLength(2);
    expect(store().addMode("theme", "Sepia")).toBeNull();
    expect(store().collections.find((c) => c.id === "theme")?.modes).toHaveLength(2);
  });

  it("adds a mode as a new column and protects the default mode from deletion", () => {
    render(<VariablesPanelContent />);
    const created = addCollectionViaUi();
    fireEvent.click(screen.getByLabelText("Add mode"));

    const modes = () => store().collections.find((c) => c.id === created.id)?.modes ?? [];
    expect(modes()).toHaveLength(2);

    fireEvent.click(screen.getByLabelText("Mode menu: Mode 1"));
    const del = screen.getByText("Delete mode");
    expect(del.closest("[data-disabled]")).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(modes()).toHaveLength(2);

    cleanup();
    render(<VariablesPanelContent />);
    fireEvent.click(screen.getByRole("tab", { name: "Collection 2" }));
    clickMenuItem("Mode menu: Mode 2", "Delete mode");
    expect(modes()).toHaveLength(1);
  });

  it("renames a collection from its menu", () => {
    render(<VariablesPanelContent />);
    addCollectionViaUi();

    clickMenuItem("Collection menu: Collection 2", "Rename collection");
    const input = screen.getByLabelText("Collection name");
    fireEvent.change(input, { target: { value: "Brand" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(store().collections.some((c) => c.name === "Brand")).toBe(true);
    expect(screen.getByRole("tab", { name: "Brand" })).toBeTruthy();
  });

  it("refuses to delete a collection that still has variables and says why", () => {
    render(<VariablesPanelContent />);
    const created = addCollectionViaUi();
    fireEvent.click(screen.getByLabelText("Add variable"));
    fireEvent.click(screen.getByText("Color"));

    clickMenuItem("Collection menu: Collection 2", "Delete collection");

    expect(store().collections.some((c) => c.id === created.id)).toBe(true);
    expect(screen.getByRole("status").textContent).toMatch(/move the variables/i);
  });

  it("deletes an empty collection and falls back to the first tab", () => {
    render(<VariablesPanelContent />);
    const created = addCollectionViaUi();

    clickMenuItem("Collection menu: Collection 2", "Delete collection");

    expect(store().collections.some((c) => c.id === created.id)).toBe(false);
    expect(screen.getByRole("tab", { name: "Theme", selected: true })).toBeTruthy();
  });
});

describe("<VariablesPanelContent /> alias picker and details", () => {
  beforeEach(() => {
    resetStores();
    seedVariablesV2();
    const accent = { ...makeThemeVariable("--accent", "#ff0000", "#aa0000"), id: "var-accent" };
    const radius = makeThemeVariable("--radius", "4", "4", "number");
    store().replaceAll([...store().variables, accent, radius]);
  });
  afterEach(() => cleanup());

  it("picks an alias target of the same type", () => {
    render(<VariablesPanelContent />);
    fireEvent.click(screen.getByLabelText("Link --accent in Light to a variable"));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByText("--radius")).toBeNull();
    fireEvent.click(within(dialog).getByText("--surface"));

    expect(variable("var-accent")?.valuesByMode?.light).toEqual({ alias: "var-surface" });
    expect(variable("var-accent")?.valuesByMode?.dark).toBe("#aa0000");
  });

  it("disables targets that would create a cycle", () => {
    render(<VariablesPanelContent />);
    // --card already aliases --surface, so --surface -> --card would close a loop.
    fireEvent.click(screen.getByLabelText("Link --surface in Light to a variable"));

    const dialog = screen.getByRole("dialog");
    const cycleTarget = within(dialog).getByText("--card").closest("button");
    expect(cycleTarget?.disabled).toBe(true);
    expect(within(dialog).getByText("--accent").closest("button")?.disabled).toBe(false);
    fireEvent.click(cycleTarget as HTMLButtonElement);
    expect(variable("var-surface")?.valuesByMode?.light).toBe("#ffffff");
  });

  it("detaches an alias into its resolved literal", () => {
    render(<VariablesPanelContent />);
    fireEvent.click(screen.getByLabelText("Detach alias of --card in Dark"));

    expect(variable("var-card")?.valuesByMode?.dark).toBe("#101010");
    expect(variable("var-card")?.valuesByMode?.light).toEqual({ alias: "var-surface" });
  });

  it("persists description, scopes and the deprecated flag, and shows a badge", () => {
    render(<VariablesPanelContent />);
    fireEvent.click(screen.getByLabelText("Details of --accent"));
    const details = screen.getByRole("group", { name: "Details of --accent" });

    const description = within(details).getByLabelText("Description");
    fireEvent.change(description, { target: { value: "Brand accent" } });
    fireEvent.blur(description);
    expect(variable("var-accent")?.description).toBe("Brand accent");

    fireEvent.click(within(details).getByRole("checkbox", { name: "fill" }));
    fireEvent.click(within(details).getByRole("checkbox", { name: "stroke" }));
    expect(variable("var-accent")?.scopes).toEqual(["fill", "stroke"]);
    fireEvent.click(within(details).getByRole("checkbox", { name: "fill" }));
    expect(variable("var-accent")?.scopes).toEqual(["stroke"]);

    expect(screen.queryByText("Deprecated", { selector: "span[data-slot=badge]" })).toBeNull();
    fireEvent.click(within(details).getByRole("checkbox", { name: "Deprecated" }));
    fireEvent.change(within(details).getByLabelText("Replaced by"), {
      target: { value: "var-surface" },
    });
    expect(variable("var-accent")?.deprecated).toEqual({ replacedBy: "var-surface" });
    expect(screen.getByText("Deprecated", { selector: "span[data-slot=badge]" })).toBeTruthy();
  });
});
