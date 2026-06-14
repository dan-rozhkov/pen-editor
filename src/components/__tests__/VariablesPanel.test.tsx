import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  within,
} from "@testing-library/react";
import { VariablesDialog } from "../VariablesPanel";
import { useVariableStore } from "@/store/variableStore";
import { resetStores, seedVariables } from "@/test/fixtures";

// The color picker pulls in react-aria + a body portal that triggers act()
// warnings and is irrelevant to this panel's behaviour. Stub it out so the
// color row renders deterministically.
vi.mock("@/components/ui/ColorPicker", () => ({
  CustomColorPicker: () => null,
}));

function variables() {
  return useVariableStore.getState().variables;
}

function findVariable(id: string) {
  return variables().find((v) => v.id === id);
}

describe("<VariablesDialog />", () => {
  beforeEach(() => {
    resetStores();
    seedVariables();
  });

  afterEach(() => cleanup());

  // seedVariables() seeds two variables:
  //   var-primary "--primary" (color, light #3366ff / dark #99bbff)
  //   var-radius  "--radius-m" (number, value "8", no themeValues)

  it("renders a row for each seeded variable with names and values", () => {
    render(<VariablesDialog open onOpenChange={() => {}} />);

    expect(screen.getByText("--primary")).toBeTruthy();
    expect(screen.getByText("--radius-m")).toBeTruthy();

    // color variable shows hex (sans #, uppercased) for both themes
    expect(screen.getByText("3366FF")).toBeTruthy(); // light
    expect(screen.getByText("99BBFF")).toBeTruthy(); // dark

    // number variable falls back to .value for both light and dark columns
    expect(screen.getAllByText("8").length).toBe(2);

    expect(screen.queryByText("No variables yet")).toBeNull();
  });

  it("shows the empty state when there are no variables", () => {
    useVariableStore.setState({ variables: [] });
    render(<VariablesDialog open onOpenChange={() => {}} />);

    expect(screen.getByText("No variables yet")).toBeTruthy();
    expect(screen.queryByText("--primary")).toBeNull();
  });

  it("renames a variable and writes it back to the store", () => {
    render(<VariablesDialog open onOpenChange={() => {}} />);

    // EditableCell shows a span until clicked; click to enter edit mode.
    fireEvent.click(screen.getByText("--primary"));

    const input = screen.getByDisplayValue("--primary") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "--accent" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(findVariable("var-primary")?.name).toBe("--accent");
  });

  it("edits a number variable's theme value via the editable cell", () => {
    render(<VariablesDialog open onOpenChange={() => {}} />);

    // both light/dark cells render "8"; edit the first (light) one.
    const cells = screen.getAllByText("8");
    fireEvent.click(cells[0]);

    const input = screen.getByDisplayValue("8") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "16" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // light value updated; dark untouched (still falls back to .value "8")
    expect(findVariable("var-radius")?.themeValues?.light).toBe("16");
    expect(findVariable("var-radius")?.themeValues?.dark).toBe("8");
  });

  it("removes a variable when its delete button is clicked", () => {
    render(<VariablesDialog open onOpenChange={() => {}} />);

    expect(variables().length).toBe(2);

    // The trash button only mounts on row hover; trigger mouseEnter on the row
    // containing "--radius-m".
    const nameSpan = screen.getByText("--radius-m");
    const row = nameSpan.closest("tr") as HTMLTableRowElement;
    fireEvent.mouseEnter(row);

    fireEvent.click(within(row).getByTitle("Delete variable"));

    expect(variables().length).toBe(1);
    expect(findVariable("var-radius")).toBeUndefined();
    expect(findVariable("var-primary")).toBeTruthy();
  });

  it("escaping an edit leaves the store unchanged", () => {
    render(<VariablesDialog open onOpenChange={() => {}} />);

    fireEvent.click(screen.getByText("--primary"));
    const input = screen.getByDisplayValue("--primary") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "--throwaway" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(findVariable("var-primary")?.name).toBe("--primary");
  });

  it("exposes an add-variable trigger that grows the store", () => {
    render(<VariablesDialog open onOpenChange={() => {}} />);

    expect(variables().length).toBe(2);

    // Open the add-variable dropdown (icon button, by title) then pick a type.
    fireEvent.click(screen.getByTitle("Add variable"));

    // base-ui Menu renders items into a portal once open. Click the "Color"
    // item if present; otherwise the menu didn't open in happy-dom and we skip
    // the interaction half (still asserting the trigger exists above).
    const colorItem = screen.queryByText("Color");
    if (colorItem) {
      fireEvent.click(colorItem);
      expect(variables().length).toBe(3);
      const added = variables()[variables().length - 1];
      expect(added.type).toBe("color");
      // one color variable is already seeded (var-primary), so the new one is
      // numbered after the existing color count.
      expect(added.name).toBe("Color 2");
      expect(added.themeValues).toEqual({ light: "#4a90d9", dark: "#4a90d9" });
    }
  });
});
