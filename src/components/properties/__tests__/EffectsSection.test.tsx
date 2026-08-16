import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { EffectsSection } from "../EffectsSection";
import { createGlassEffect } from "@/utils/fillUtils";
import type {
  BackgroundBlurEffect,
  BlurEffect,
  Effect,
  GlassEffect,
  SceneNode,
  ShadowEffect,
} from "@/types/scene";

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
  DropdownMenuItem: ({ children, onClick, disabled }: ComponentProps<"button">) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
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

function backgroundBlurFx(extra: Partial<BackgroundBlurEffect> = {}): BackgroundBlurEffect {
  return { type: "background-blur", id: "bb1", radius: 8, ...extra };
}

function glassFx(extra: Partial<GlassEffect> = {}): GlassEffect {
  return {
    type: "glass",
    id: "g1",
    lightAngle: 135,
    lightIntensity: 0.5,
    refraction: 0.35,
    depth: 12,
    dispersion: 0.15,
    frost: 8,
    splay: 0.4,
    ...extra,
  };
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

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "24" } });
    fireEvent.blur(input);
    expect(onUpdate.mock.calls[0][0].effects[0].radius).toBe(24);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "250" } });
    fireEvent.blur(input);
    expect(onUpdate.mock.calls[1][0].effects[0].radius).toBe(100);
  });

  it("adds a background blur via the add menu", () => {
    const onUpdate = vi.fn();
    render(<EffectsSection node={makeNode()} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByText("Background blur"));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const arg = onUpdate.mock.calls[0][0];
    expect(arg.effects).toHaveLength(1);
    expect(arg.effects[0]).toMatchObject({ type: "background-blur", radius: 4 });
    expect(arg.effect).toBeUndefined();
  });

  it("renders a background blur effect row with its radius", () => {
    render(<EffectsSection node={makeNode([backgroundBlurFx()])} onUpdate={vi.fn()} />);

    expect(screen.getAllByText("Background Blur").length).toBeGreaterThan(0);
    const inputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    expect(inputs).toHaveLength(1); // blur editor: just the radius input
    expect(inputs[0].value).toBe("8");
  });

  it("edits the background blur radius, clamped to 0-100", () => {
    const onUpdate = vi.fn();
    render(<EffectsSection node={makeNode([backgroundBlurFx()])} onUpdate={onUpdate} />);
    const input = screen.getByRole("spinbutton");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "24" } });
    fireEvent.blur(input);
    expect(onUpdate.mock.calls[0][0].effects[0].radius).toBe(24);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "250" } });
    fireEvent.blur(input);
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

    fireEvent.click(screen.getByLabelText("Remove effect"));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][0].effects).toEqual([]);
  });

  it("toggles effect visibility via the eye button", () => {
    const onUpdate = vi.fn();
    render(
      <EffectsSection node={makeNode([shadow({ visible: true })])} onUpdate={onUpdate} />,
    );

    // visible → button title is "Hide effect"
    fireEvent.click(screen.getByLabelText("Hide effect"));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][0].effects[0].visible).toBe(false);
  });

  it("shows the 'Show effect' control and toggles a hidden effect back on", () => {
    const onUpdate = vi.fn();
    render(
      <EffectsSection node={makeNode([shadow({ visible: false })])} onUpdate={onUpdate} />,
    );

    fireEvent.click(screen.getByLabelText("Show effect"));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][0].effects[0].visible).toBe(true);
  });

  it("edits the X and Y offset", () => {
    const onUpdate = vi.fn();
    render(
      <EffectsSection node={makeNode([shadow()])} onUpdate={onUpdate} />,
    );
    const inputs = screen.getAllByRole("spinbutton");

    fireEvent.focus(inputs[1]);
    fireEvent.change(inputs[1], { target: { value: "10" } }); // X
    fireEvent.blur(inputs[1]);
    expect(onUpdate.mock.calls[0][0].effects[0].offset).toEqual({ x: 10, y: 4 });

    fireEvent.focus(inputs[2]);
    fireEvent.change(inputs[2], { target: { value: "-3" } }); // Y
    fireEvent.blur(inputs[2]);
    expect(onUpdate.mock.calls[1][0].effects[0].offset).toEqual({ x: 2, y: -3 });
  });

  it("edits blur (clamped to >= 0) and spread", () => {
    const onUpdate = vi.fn();
    render(
      <EffectsSection node={makeNode([shadow()])} onUpdate={onUpdate} />,
    );
    const inputs = screen.getAllByRole("spinbutton");

    fireEvent.focus(inputs[3]);
    fireEvent.change(inputs[3], { target: { value: "20" } }); // Blur
    fireEvent.blur(inputs[3]);
    expect(onUpdate.mock.calls[0][0].effects[0].blur).toBe(20);

    fireEvent.focus(inputs[4]);
    fireEvent.change(inputs[4], { target: { value: "5" } }); // Spread
    fireEvent.blur(inputs[4]);
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
    fireEvent.focus(inputs[0]);
    fireEvent.change(inputs[0], { target: { value: "50" } });
    fireEvent.blur(inputs[0]);
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

  it("adds a glass effect via the add menu, without touching fills/fillOpacity", () => {
    const onUpdate = vi.fn();
    render(<EffectsSection node={makeNode()} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByText("Glass"));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const arg = onUpdate.mock.calls[0][0];
    expect(arg.effects).toHaveLength(1);
    expect(arg.effects[0]).toMatchObject({
      type: "glass",
      lightAngle: 135,
      lightIntensity: 0.55,
      refraction: 0.45,
      depth: 14,
      dispersion: 0.06,
      frost: 18,
      splay: 0.55,
      vibrancy: 0.5,
    });
    expect(arg.effect).toBeUndefined();
    // Figma silently drops fill alpha when adding Glass; this editor must not.
    expect(arg.fills).toBeUndefined();
    expect(arg.fillOpacity).toBeUndefined();
  });

  it("renders a glass effect row with its eight parameter values", () => {
    render(
      <EffectsSection node={makeNode([glassFx({ vibrancy: 0.6 })])} onUpdate={vi.fn()} />,
    );

    expect(screen.getAllByText("Glass").length).toBeGreaterThan(0);
    const inputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    // DOM order: angle, intensity%, refraction%, depth, dispersion%, frost, splay%, vibrancy%
    expect(inputs).toHaveLength(8);
    expect(inputs[0].value).toBe("135"); // lightAngle
    expect(inputs[1].value).toBe("50"); // lightIntensity 0.5 -> 50%
    expect(inputs[2].value).toBe("35"); // refraction 0.35 -> 35%
    expect(inputs[3].value).toBe("12"); // depth
    expect(inputs[4].value).toBe("15"); // dispersion 0.15 -> 15%
    expect(inputs[5].value).toBe("8"); // frost
    expect(inputs[6].value).toBe("40"); // splay 0.4 -> 40%
    expect(inputs[7].value).toBe("60"); // vibrancy 0.6 -> 60%
  });

  it("defaults the vibrancy display to 50% when the effect predates the field", () => {
    render(<EffectsSection node={makeNode([glassFx()])} onUpdate={vi.fn()} />);
    const inputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    expect(inputs[7].value).toBe("50");
  });

  it("edits the vibrancy control", () => {
    const onUpdate = vi.fn();
    render(<EffectsSection node={makeNode([glassFx()])} onUpdate={onUpdate} />);
    const inputs = screen.getAllByRole("spinbutton");

    fireEvent.focus(inputs[7]);
    fireEvent.change(inputs[7], { target: { value: "75" } });
    fireEvent.blur(inputs[7]);
    expect(onUpdate.mock.calls[0][0].effects[0].vibrancy).toBe(0.75);
  });

  it("edits every glass control", () => {
    const onUpdate = vi.fn();
    render(<EffectsSection node={makeNode([glassFx()])} onUpdate={onUpdate} />);
    const inputs = screen.getAllByRole("spinbutton");

    const editAt = (index: number, value: string) => {
      fireEvent.focus(inputs[index]);
      fireEvent.change(inputs[index], { target: { value } });
      fireEvent.blur(inputs[index]);
    };

    editAt(0, "400"); // angle wraps: 400 % 360 = 40
    expect(onUpdate.mock.calls[0][0].effects[0].lightAngle).toBe(40);

    editAt(1, "80"); // intensity 80% -> 0.8
    expect(onUpdate.mock.calls[1][0].effects[0].lightIntensity).toBe(0.8);

    editAt(2, "60"); // refraction 60% -> 0.6
    expect(onUpdate.mock.calls[2][0].effects[0].refraction).toBe(0.6);

    editAt(3, "20"); // depth px
    expect(onUpdate.mock.calls[3][0].effects[0].depth).toBe(20);

    editAt(4, "25"); // dispersion 25% -> 0.25
    expect(onUpdate.mock.calls[4][0].effects[0].dispersion).toBe(0.25);

    editAt(5, "16"); // frost px
    expect(onUpdate.mock.calls[5][0].effects[0].frost).toBe(16);

    editAt(6, "90"); // splay 90% -> 0.9
    expect(onUpdate.mock.calls[6][0].effects[0].splay).toBe(0.9);

    editAt(7, "80"); // vibrancy 80% -> 0.8
    expect(onUpdate.mock.calls[7][0].effects[0].vibrancy).toBe(0.8);
  });

  it("applies an iOS material preset, overwriting glass params but keeping the effect id", () => {
    const onUpdate = vi.fn();
    render(<EffectsSection node={makeNode([glassFx({ id: "g1" })])} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByText("Thick"));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const applied = onUpdate.mock.calls[0][0].effects[0];
    expect(applied.id).toBe("g1");
    expect(applied).toMatchObject({
      lightAngle: 135,
      lightIntensity: 0.7,
      refraction: 0.6,
      depth: 22,
      dispersion: 0.08,
      frost: 34,
      splay: 0.7,
      vibrancy: 0.6,
    });
  });

  it("applies the Regular preset, matching the default createGlassEffect() tuple", () => {
    const onUpdate = vi.fn();
    render(
      <EffectsSection
        node={makeNode([glassFx({ frost: 99, vibrancy: 0.1 })])}
        onUpdate={onUpdate}
      />,
    );

    fireEvent.click(screen.getByText("Regular"));

    const applied = onUpdate.mock.calls[0][0].effects[0];
    // Compare field-for-field against the factory's own output (not a
    // hand-typed literal), so retuning `createGlassEffect()` without also
    // updating the "Regular" preset fails this test instead of drifting
    // silently — the documented "Regular === add Glass fresh" invariant.
    const { id: _id, type: _type, ...defaultParams } = createGlassEffect();
    expect(applied).toMatchObject(defaultParams);
  });

  it("clamps an over-range depth to the documented max (1000) on commit", () => {
    const onUpdate = vi.fn();
    render(<EffectsSection node={makeNode([glassFx()])} onUpdate={onUpdate} />);
    const inputs = screen.getAllByRole("spinbutton");

    fireEvent.focus(inputs[3]); // Depth
    fireEvent.change(inputs[3], { target: { value: "5000" } });
    fireEvent.blur(inputs[3]);

    expect(onUpdate.mock.calls[0][0].effects[0].depth).toBe(1000);
  });

  it("clamps an over-range frost to the documented max (100) on commit", () => {
    const onUpdate = vi.fn();
    render(<EffectsSection node={makeNode([glassFx()])} onUpdate={onUpdate} />);
    const inputs = screen.getAllByRole("spinbutton");

    fireEvent.focus(inputs[5]); // Frost
    fireEvent.change(inputs[5], { target: { value: "300" } });
    fireEvent.blur(inputs[5]);

    expect(onUpdate.mock.calls[0][0].effects[0].frost).toBe(100);
  });

  it("toggles and removes a glass effect", () => {
    const onUpdate = vi.fn();
    render(<EffectsSection node={makeNode([glassFx({ visible: true })])} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByLabelText("Hide effect"));
    expect(onUpdate.mock.calls[0][0].effects[0].visible).toBe(false);

    fireEvent.click(screen.getByLabelText("Remove effect"));
    expect(onUpdate.mock.calls[1][0].effects).toEqual([]);
  });

  it("disables the Glass add-menu item once the stack already has one", () => {
    render(<EffectsSection node={makeNode([glassFx()])} onUpdate={vi.fn()} />);
    // Scope to the add-menu root (the "Add effect" trigger's sibling content) so
    // the row's own "Glass" label/popover title don't get matched instead.
    const addMenuRoot = screen.getByTitle("Add effect").parentElement as HTMLElement;
    const addMenuButton = within(addMenuRoot).getByText("Glass").closest("button");
    expect(addMenuButton?.disabled).toBe(true);
  });

  it("marks the lower material effect active and the higher one inactive (glass over background blur)", () => {
    render(
      <EffectsSection
        node={makeNode([backgroundBlurFx(), glassFx()])}
        onUpdate={vi.fn()}
      />,
    );
    // background blur is first (bottom) in the stack, so it wins the material slot;
    // glass (on top) is inactive.
    expect(
      screen.getByText(/Inactive: another material effect lower in the stack renders instead/),
    ).toBeTruthy();
  });

  it("marks the lower material effect active and the higher one inactive (background blur over glass)", () => {
    render(
      <EffectsSection
        node={makeNode([glassFx(), backgroundBlurFx()])}
        onUpdate={vi.fn()}
      />,
    );
    // glass is first (bottom) in the stack, so it wins; background blur (on top) is
    // inactive. Exactly one inactive note should render.
    expect(
      screen.getAllByText(/Inactive: another material effect lower in the stack renders instead/)
        .length,
    ).toBe(1);
  });

  it("hints that glass will not show through a fully opaque fill", () => {
    const opaqueNode = {
      ...makeNode([glassFx()]),
      fills: [{ id: "f1", type: "solid", color: "#ff0000ff" }],
    } as unknown as SceneNode;
    render(<EffectsSection node={opaqueNode} onUpdate={vi.fn()} />);

    expect(
      screen.getByText(/This fill is fully opaque, so glass will not be visible through it/),
    ).toBeTruthy();
  });

  it("does not hint about opacity when the fill is translucent", () => {
    const translucentNode = {
      ...makeNode([glassFx()]),
      fills: [{ id: "f1", type: "solid", color: "#ff000080" }],
    } as unknown as SceneNode;
    render(<EffectsSection node={translucentNode} onUpdate={vi.fn()} />);

    expect(
      screen.queryByText(/This fill is fully opaque, so glass will not be visible through it/),
    ).toBeNull();
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
