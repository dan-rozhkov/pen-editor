import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { VariablesPanelContent } from "../VariablesPanel";
import { useDesignSystemScopeStore } from "@/store/designSystemScopeStore";
import { globMatcher } from "@/lib/designSystem/scope";
import { resetStores, seedVariables } from "@/test/fixtures";

vi.mock("@/components/ui/ColorPicker", () => ({
  CustomColorPicker: () => null,
}));

const scopes = () => useDesignSystemScopeStore.getState().scopes;

function openMenu() {
  fireEvent.click(screen.getByLabelText("Scopes"));
}

describe("<VariablesPanelContent /> Scopes menu", () => {
  beforeEach(() => {
    resetStores();
    seedVariables();
  });
  afterEach(() => cleanup());

  it("saves the active collection as a scope", () => {
    render(<VariablesPanelContent />);
    openMenu();
    fireEvent.click(screen.getByText('Save "Theme" as scope'));

    expect(scopes()).toHaveLength(1);
    expect(scopes()[0]).toMatchObject({ name: "Theme", collections: ["theme"] });
  });

  it("saves the current search as a name-glob scope, and disables that item without a search", () => {
    render(<VariablesPanelContent />);
    openMenu();
    expect(screen.getByText("Save search as scope").closest("[role=menuitem]")?.getAttribute("aria-disabled")).toBe("true");
    fireEvent.keyDown(document.body, { key: "Escape" });

    fireEvent.change(screen.getByLabelText("Search variables"), { target: { value: "primary" } });
    openMenu();
    fireEvent.click(screen.getByText("Save search as scope"));

    expect(scopes()[0]).toMatchObject({ name: "Search: primary", names: ["*primary*"], collections: ["theme"] });
    expect(scopes()[0].components).toBeUndefined();
  });

  it("saves a search with * and ? as a literal substring", () => {
    render(<VariablesPanelContent />);
    fireEvent.change(screen.getByLabelText("Search variables"), { target: { value: "a*b?" } });
    openMenu();
    fireEvent.click(screen.getByText("Save search as scope"));

    expect(scopes()[0].names).toEqual(["*a\\*b\\?*"]);
    expect(globMatcher(scopes()[0].names)?.("x-a*b?-y")).toBe(true);
    expect(globMatcher(scopes()[0].names)?.("x-aZbZ-y")).toBe(false);
  });

  it("lists saved scopes and deletes one", () => {
    useDesignSystemScopeStore.getState().setScopes([
      { id: "s1", name: "Brand only" },
      { id: "s2", name: "Buttons" },
    ]);
    render(<VariablesPanelContent />);
    openMenu();
    fireEvent.click(screen.getByText('Delete scope "Brand only"'));

    expect(scopes().map((s) => s.name)).toEqual(["Buttons"]);
  });

  it("tells the user when nothing is saved yet", () => {
    render(<VariablesPanelContent />);
    openMenu();
    expect(screen.getByText("No saved scopes")).toBeTruthy();
  });
});
