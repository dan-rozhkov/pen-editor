import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { ThemeSection } from "../ThemeSection";
import { useVariableStore } from "@/store/variableStore";
import { makeThemeCollection } from "@/lib/variables";
import type { FrameNode } from "@/types/scene";
import type { VariableCollection } from "@/types/variable";

// Base UI's Select needs a real popup; a native select keeps the test on our logic.
vi.mock("@/components/ui/select", () => ({
  SelectWithOptions: (props: {
    value: string;
    onValueChange: (v: string | null) => void;
    options: { value: string; label: string }[];
    ariaLabel?: string;
  }) => (
    <select aria-label={props.ariaLabel} value={props.value} onChange={(e) => props.onValueChange(e.target.value)}>
      {props.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock("@/components/ui/PropertyInputs", async (orig) => {
  const actual = await orig<typeof import("@/components/ui/PropertyInputs")>();
  return {
    ...actual,
    PropertySection: ({ title, children }: { title: string; children: ReactNode }) => (
      <section>
        <h3>{title}</h3>
        {children}
      </section>
    ),
  };
});

const brand: VariableCollection = {
  id: "brand",
  name: "Brand",
  modes: [
    { id: "acme", name: "Acme" },
    { id: "globex", name: "Globex" },
  ],
  defaultModeId: "acme",
};

function frame(extra: Partial<FrameNode> = {}): FrameNode {
  return { id: "f1", type: "frame", x: 0, y: 0, width: 100, height: 100, ...extra } as FrameNode;
}

beforeEach(() => {
  useVariableStore.setState({ variables: [], collections: [makeThemeCollection()] });
});
afterEach(() => cleanup());

describe("<ThemeSection />", () => {
  it("single Theme collection: titled Theme with Inherit / Light / Dark", () => {
    render(<ThemeSection node={frame()} onUpdate={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Theme" })).toBeTruthy();
    const select = screen.getByLabelText("Theme") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.text)).toEqual(["Inherit", "Light", "Dark"]);
    expect(select.value).toBe("inherit");
  });

  it("reads a legacy themeOverride", () => {
    render(<ThemeSection node={frame({ themeOverride: "dark" })} onUpdate={vi.fn()} />);
    expect((screen.getByLabelText("Theme") as HTMLSelectElement).value).toBe("dark");
  });

  it("writes modeOverrides and drops the legacy themeOverride", () => {
    const onUpdate = vi.fn();
    render(<ThemeSection node={frame({ themeOverride: "light" })} onUpdate={onUpdate} />);
    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "dark" } });
    expect(onUpdate).toHaveBeenCalledWith({ modeOverrides: { theme: "dark" }, themeOverride: undefined });
  });

  it("multi-collection: titled Modes, one picker per collection with 2+ modes", () => {
    useVariableStore.setState({
      collections: [makeThemeCollection(), brand, { id: "solo", name: "Solo", modes: [{ id: "a", name: "A" }], defaultModeId: "a" }],
    });
    render(<ThemeSection node={frame()} onUpdate={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Modes" })).toBeTruthy();
    expect(screen.getByLabelText("Theme")).toBeTruthy();
    const b = screen.getByLabelText("Brand") as HTMLSelectElement;
    expect(Array.from(b.options).map((o) => o.text)).toEqual(["Inherit", "Acme", "Globex"]);
    expect(screen.queryByLabelText("Solo")).toBeNull();
  });

  it("setting one key keeps the others (full object)", () => {
    useVariableStore.setState({ collections: [makeThemeCollection(), brand] });
    const onUpdate = vi.fn();
    render(<ThemeSection node={frame({ modeOverrides: { theme: "dark" } })} onUpdate={onUpdate} />);
    fireEvent.change(screen.getByLabelText("Brand"), { target: { value: "globex" } });
    expect(onUpdate).toHaveBeenCalledWith({ modeOverrides: { theme: "dark", brand: "globex" }, themeOverride: undefined });
  });

  it("clearing a key removes it; the last key leaves modeOverrides undefined", () => {
    useVariableStore.setState({ collections: [makeThemeCollection(), brand] });
    const onUpdate = vi.fn();
    const { rerender } = render(
      <ThemeSection node={frame({ modeOverrides: { theme: "dark", brand: "globex" } })} onUpdate={onUpdate} />,
    );
    fireEvent.change(screen.getByLabelText("Brand"), { target: { value: "inherit" } });
    expect(onUpdate).toHaveBeenLastCalledWith({ modeOverrides: { theme: "dark" }, themeOverride: undefined });
    rerender(<ThemeSection node={frame({ modeOverrides: { theme: "dark" } })} onUpdate={onUpdate} />);
    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "inherit" } });
    expect(onUpdate).toHaveBeenLastCalledWith({ modeOverrides: undefined, themeOverride: undefined });
  });
});
