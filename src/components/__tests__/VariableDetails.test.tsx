import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { VariableDetails } from "../VariableDetails";
import { useVariableStore } from "@/store/variableStore";
import { resetStores } from "@/test/fixtures";
import type { Variable } from "@/types/variable";

const color = (id: string, name: string, extra: Partial<Variable> = {}): Variable => ({
  id,
  name,
  type: "color",
  collectionId: "theme",
  valuesByMode: { light: "#111111", dark: "#111111" },
  value: "#111111",
  ...extra,
});

describe("<VariableDetails /> replacement picker", () => {
  beforeEach(() => {
    resetStores();
    const collections = useVariableStore.getState().collections;
    useVariableStore.getState().replaceAll(
      [color("old", "Old", { deprecated: {} }), color("mine", "Mine"), color("lib", "Library One", { libraryId: "lib_x" })],
      collections,
    );
  });
  afterEach(() => cleanup());

  it("lists local variables only, not library-owned ones", () => {
    const old = useVariableStore.getState().variables[0];
    render(<VariableDetails variable={old} />);
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain("Mine");
    expect(options).not.toContain("Library One");
  });

  it("stores a picked replacement through the deprecation validation", () => {
    const old = useVariableStore.getState().variables[0];
    render(<VariableDetails variable={old} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "mine" } });
    expect(useVariableStore.getState().variables.find((v) => v.id === "old")?.deprecated?.replacedBy).toBe("mine");
  });

  it("shows the refusal of a replacement as an alert and clears it on the next valid edit", () => {
    const ghost = color("ghost", "Ghost", { deprecated: {} });
    render(<VariableDetails variable={ghost} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "mine" } });
    expect(screen.getByRole("alert").textContent).toContain("Variable not found");
  });
});
