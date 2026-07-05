import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { EffectsSection } from "../EffectsSection";
import type { BlurEffect, Effect, SceneNode, ShadowEffect } from "@/types/scene";

// The ColorInput in PropertyInputs renders CustomColorPicker, which mounts a
// portal/popover. Stub it so the component tree is deterministic and free of
// act() warnings. With it stubbed, ColorInput's only interactive element is the
// hex text <input> (the variable dropdown is absent — no availableVariables).
vi.mock("@/components/ui/ColorPicker", () => ({
  CustomColorPicker: () => null,
}));

// The per-effect detail editor now lives in a base-ui popover, which portals and
// is flaky to drive open in happy-dom. Render trigger + content inline so the
// shadow parameter inputs are always in the DOM.
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children, ...props }: ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// The add-effect menu is a base-ui dropdown; render it inline like the popover.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children?: ReactNode }) => (
    <button title="Add effect">{children}</button>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: ComponentProps<"button">) => (
    <button onClick={onClick}>{children}</button>
  ),
}));

function shadow(extra: Partial<ShadowEffect> = {}): ShadowEffect {
  return {
    type: "shadow",
    shadowType: "outer",
    id: "e1",
    color: "#00000040",
    offset: { x: 2, y: 4 },
    blur: 8,
    spread: 1,
    ...extra,
  } as ShadowEffect;
}

function makeNode(effects?: Effect[]): SceneNode {
  return {
    id: "n1",
    type: "rect",
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    ...(effects ? { effects } : {}),
  } as unknown as SceneNode;
}

function blurFx(extra: Partial<BlurEffect> = {}): BlurEffect {
  return { type: "blur", id: "b1", radius: 8, ...extra };
}

afterEach(() => cleanup());

describe("<EffectsSection />", () => {
  it("renders nothing for the effect list when there are no effects (empty state)", () => {
    render(<EffectsSection node={makeNode()} onUpdate={vi.fn()} />);
    // The "Effects" section title and the Add action are always present...
    expect(screen.getByText("Effects")).toBeTruthy();
    expect(screen.getByTitle("Add effect")).toBeTruthy();
    // ...but no effect card / spinbuttons are rendered.
    expect(screen.queryByText("Drop Shadow")).toBeNull();
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
  });

  it("labels an inner shadow as 'Inner Shadow' (derived from shadowType)", () => {
    render(
      <EffectsSection
        node={makeNode([shadow({ shadowType: "inner" })])}
        onUpdate={vi.fn()}
      />,
    );
    expect(screen.getAllByText("Inner Shadow").length).toBeGreaterThan(0);
    expect(screen.queryByText("Drop Shadow")).toBeNull();
  });

  it("renders an existing shadow effect with its parameter values", () => {
    render(
      <EffectsSection
        node={makeNode([shadow({ color: "#11223380" })])}
        onUpdate={vi.fn()}
      />,
    );
    // "Drop Shadow" now appears twice: the collapsed row label + the popover title.
    expect(screen.getAllByText("Drop Shadow").length).toBeGreaterThan(0);
    expect(screen.queryByText("Inner Shadow")).toBeNull();

    const inputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    // DOM order per card: opacity %, X, Y, Blur, Spread
    expect(inputs).toHaveLength(5);
    expect(inputs[0].value).toBe("50"); // 0x80 / 255 ≈ 0.5019 → round(50.19) = 50
    expect(inputs[1].value).toBe("2"); // offset.x
    expect(inputs[2].value).toBe("4"); // offset.y
    expect(inputs[3].value).toBe("8"); // blur
    expect(inputs[4].value).toBe("1"); // spread
  });

  it("adds a new shadow effect via the add menu", () => {
    const onUpdate = vi.fn();
    render(<EffectsSection node={makeNode()} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByText("Drop shadow"));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const arg = onUpdate.mock.calls[0][0];
    expect(arg.effects).toHaveLength(1);
    expect(arg.effects[0]).toMatchObject({ type: "shadow", shadowType: "outer" });
    expect(arg.effect).toBeUndefined();
  });

  it("adds a new inner shadow effect via the add menu", () => {
    const onUpdate = vi.fn();
    render(<EffectsSection node={makeNode()} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByText("Inner shadow"));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const arg = onUpdate.mock.calls[0][0];
    expect(arg.effects).toHaveLength(1);
    expect(arg.effects[0]).toMatchObject({ type: "shadow", shadowType: "inner" });
    expect(arg.effect).toBeUndefined();
  });

  it("adds a layer blur via the add menu", () => {
    const onUpdate = vi.fn();
    render(<EffectsSection node={makeNode()} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByText("Layer blur"));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const arg = onUpdate.mock.calls[0][0];
    expect(arg.effects).toHaveLength(1);
    expect(arg.effects[0]).toMatchObject({ type: "blur", radius: 4 });
    expect(arg.effect).toBeUndefined();
  });

  it("renders a blur effect row with its radius", () => {
    render(<EffectsSection node={makeNode([blurFx()])} onUpdate={vi.fn()} />);

    expect(screen.getAllByText("Layer Blur").length).toBeGreaterThan(0);
    const inputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    expect(inputs).toHaveLength(1); // blur editor: just the radius input
    expect(inputs[0].value).toBe("8");
  });

  it("edits the blur radius, clamped to 0-100", () => {
    const onUpdate = vi.fn();
    render(<EffectsSection node={makeNode([blurFx()])} onUpdate={onUpdate} />);
    const input = screen.getByRole("spinbutton");

    fireEvent.change(input, { target: { value: "24" } });
    expect(onUpdate.mock.calls[0][0].effects[0].radius).toBe(24);

    fireEvent.change(input, { target: { value: "250" } });
    expect(onUpdate.mock.calls[1][0].effects[0].radius).toBe(100);
  });

  it("renders shadow and blur rows together", () => {
    render(
      <EffectsSection node={makeNode([shadow(), blurFx()])} onUpdate={vi.fn()} />,
    );
    expect(screen.getAllByText("Drop Shadow").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Layer Blur").length).toBeGreaterThan(0);
    // 5 shadow spinbuttons + 1 blur spinbutton
    expect(screen.getAllByRole("spinbutton")).toHaveLength(6);
  });

  it("removes an effect via the trash button", () => {
    const onUpdate = vi.fn();
    render(
      <EffectsSection node={makeNode([shadow()])} onUpdate={onUpdate} />,
    );

    fireEvent.click(screen.getByTitle("Remove effect"));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][0].effects).toEqual([]);
  });

  it("toggles effect visibility via the eye button", () => {
    const onUpdate = vi.fn();
    render(
      <EffectsSection node={makeNode([shadow({ visible: true })])} onUpdate={onUpdate} />,
    );

    // visible → button title is "Hide effect"
    fireEvent.click(screen.getByTitle("Hide effect"));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][0].effects[0].visible).toBe(false);
  });

  it("shows the 'Show effect' control and toggles a hidden effect back on", () => {
    const onUpdate = vi.fn();
    render(
      <EffectsSection node={makeNode([shadow({ visible: false })])} onUpdate={onUpdate} />,
    );

    fireEvent.click(screen.getByTitle("Show effect"));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][0].effects[0].visible).toBe(true);
  });

  it("edits the X and Y offset", () => {
    const onUpdate = vi.fn();
    render(
      <EffectsSection node={makeNode([shadow()])} onUpdate={onUpdate} />,
    );
    const inputs = screen.getAllByRole("spinbutton");

    fireEvent.change(inputs[1], { target: { value: "10" } }); // X
    expect(onUpdate.mock.calls[0][0].effects[0].offset).toEqual({ x: 10, y: 4 });

    fireEvent.change(inputs[2], { target: { value: "-3" } }); // Y
    expect(onUpdate.mock.calls[1][0].effects[0].offset).toEqual({ x: 2, y: -3 });
  });

  it("edits blur (clamped to >= 0) and spread", () => {
    const onUpdate = vi.fn();
    render(
      <EffectsSection node={makeNode([shadow()])} onUpdate={onUpdate} />,
    );
    const inputs = screen.getAllByRole("spinbutton");

    fireEvent.change(inputs[3], { target: { value: "20" } }); // Blur
    expect(onUpdate.mock.calls[0][0].effects[0].blur).toBe(20);

    fireEvent.change(inputs[4], { target: { value: "5" } }); // Spread
    expect(onUpdate.mock.calls[1][0].effects[0].spread).toBe(5);
  });

  it("edits the color opacity %, encoding it into the hex alpha channel", () => {
    const onUpdate = vi.fn();
    render(
      <EffectsSection
        node={makeNode([shadow({ color: "#112233ff" })])}
        onUpdate={onUpdate}
      />,
    );
    const inputs = screen.getAllByRole("spinbutton");

    // 50% → alpha = round(0.5 * 255) = 128 = 0x80, base color preserved
    fireEvent.change(inputs[0], { target: { value: "50" } });
    expect(onUpdate.mock.calls[0][0].effects[0].color).toBe("#11223380");
  });

  it("edits the color via the hex text input", () => {
    const onUpdate = vi.fn();
    render(
      <EffectsSection node={makeNode([shadow({ color: "#00000040" })])} onUpdate={onUpdate} />,
    );

    // With CustomColorPicker stubbed, ColorInput's hex <input> is the only textbox.
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "#abcdef" } });
    expect(onUpdate.mock.calls[0][0].effects[0].color).toBe("#abcdef");
  });

  it("renders a Mixed placeholder when effects are mixed across a selection", () => {
    render(
      <EffectsSection
        node={makeNode([shadow()])}
        onUpdate={vi.fn()}
        mixedKeys={new Set(["effects"])}
      />,
    );
    expect(screen.getByText("Mixed")).toBeTruthy();
    expect(screen.queryByText("Drop Shadow")).toBeNull();
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
  });
});
