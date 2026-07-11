import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { GradientEditor } from "../GradientEditor";
import type { GradientFill } from "@/types/scene";

// ColorInput (via ColorInput in PropertyInputs) mounts CustomColorPicker, a
// portal/popover with layout effects. Stub it so the component tree stays
// deterministic and free of act() warnings. The plain hex <input> remains.
vi.mock("@/components/ui/ColorPicker", () => ({
  CustomColorPicker: () => null,
}));

function linearGradient(extra: Partial<GradientFill> = {}): GradientFill {
  return {
    type: "linear",
    stops: [
      { color: "#000000", position: 0 },
      { color: "#ffffff", position: 1 },
    ],
    startX: 0,
    startY: 0.5,
    endX: 1,
    endY: 0.5,
    ...extra,
  };
}

function radialGradient(): GradientFill {
  return {
    type: "radial",
    stops: [
      { color: "#000000", position: 0 },
      { color: "#ffffff", position: 1 },
    ],
    startX: 0.5,
    startY: 0.5,
    endX: 0.5,
    endY: 0.5,
    startRadius: 0,
    endRadius: 0.5,
  };
}

afterEach(() => cleanup());

describe("<GradientEditor />", () => {
  it("renders the selected stop color and position percentage", () => {
    render(<GradientEditor gradient={linearGradient()} onChange={vi.fn()} />);

    // First stop selected by default: color #000000, position 0.
    const hex = screen.getByPlaceholderText("#000000") as HTMLInputElement;
    expect(hex.value).toBe("#000000");

    const spinbuttons = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    // First spinbutton = stop position (%). Position 0 -> "0".
    expect(spinbuttons[0].value).toBe("0");
  });

  it("shows the Angle input for a linear gradient at the correct degrees", () => {
    render(<GradientEditor gradient={linearGradient()} onChange={vi.fn()} />);
    // Default linear gradient goes left->right => 0 degrees.
    expect(screen.getByText("Angle")).toBeTruthy();
    const spinbuttons = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    // [position, angle]
    expect(spinbuttons[1].value).toBe("0");
  });

  it("omits the Angle input for a radial gradient", () => {
    render(<GradientEditor gradient={radialGradient()} onChange={vi.fn()} />);
    expect(screen.queryByText("Angle")).toBeNull();
    // Only the position spinbutton remains.
    expect(screen.getAllByRole("spinbutton")).toHaveLength(1);
  });

  it("updates the selected stop's color via the hex input", () => {
    const onChange = vi.fn();
    render(<GradientEditor gradient={linearGradient()} onChange={onChange} />);

    fireEvent.change(screen.getByPlaceholderText("#000000"), {
      target: { value: "#ff0000" },
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as GradientFill;
    expect(next.stops[0].color).toBe("#ff0000");
    expect(next.stops[1].color).toBe("#ffffff");
  });

  it("updates the selected stop's position (percent -> 0..1 fraction)", () => {
    const onChange = vi.fn();
    render(<GradientEditor gradient={linearGradient()} onChange={onChange} />);

    const spinbuttons = screen.getAllByRole("spinbutton");
    fireEvent.change(spinbuttons[0], { target: { value: "25" } });

    const next = onChange.mock.calls[0][0] as GradientFill;
    expect(next.stops[0].position).toBeCloseTo(0.25);
  });

  it("clamps stop position to the 0..100 range", () => {
    const onChange = vi.fn();
    render(<GradientEditor gradient={linearGradient()} onChange={onChange} />);

    fireEvent.change(screen.getAllByRole("spinbutton")[0], {
      target: { value: "150" },
    });

    const next = onChange.mock.calls[0][0] as GradientFill;
    expect(next.stops[0].position).toBe(1);
  });

  it("adds a stop via the Add button", () => {
    const onChange = vi.fn();
    render(<GradientEditor gradient={linearGradient()} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText("Add stop"));

    const next = onChange.mock.calls[0][0] as GradientFill;
    expect(next.stops).toHaveLength(3);
  });

  it("removes the selected stop via the Remove button (when >2 stops)", () => {
    const onChange = vi.fn();
    const gradient = linearGradient({
      stops: [
        { color: "#000000", position: 0 },
        { color: "#888888", position: 0.5 },
        { color: "#ffffff", position: 1 },
      ],
    });
    render(<GradientEditor gradient={gradient} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText("Remove stop"));

    const next = onChange.mock.calls[0][0] as GradientFill;
    // The first (selected) stop is removed.
    expect(next.stops).toHaveLength(2);
    expect(next.stops.map((s) => s.color)).toEqual(["#888888", "#ffffff"]);
  });

  it("disables the Remove button when only two stops remain", () => {
    render(<GradientEditor gradient={linearGradient()} onChange={vi.fn()} />);
    const remove = screen.getByLabelText("Remove stop") as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
  });

  it("updates the gradient angle for a linear gradient", () => {
    const onChange = vi.fn();
    render(<GradientEditor gradient={linearGradient()} onChange={onChange} />);

    const spinbuttons = screen.getAllByRole("spinbutton");
    // angle is the second spinbutton
    fireEvent.change(spinbuttons[1], { target: { value: "90" } });

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as GradientFill;
    // 90deg -> start top, end bottom (cos90 ~ 0, sin90 = 1).
    expect(next.startY).toBeCloseTo(0);
    expect(next.endY).toBeCloseTo(1);
  });
});
