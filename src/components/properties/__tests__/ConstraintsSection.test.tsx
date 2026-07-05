import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ConstraintsSection } from "../ConstraintsSection";
import { toggleConstraintEdge } from "@/utils/constraintsLayout";
import type { SceneNode } from "@/types/scene";

function makeNode(extra: Partial<SceneNode> = {}): SceneNode {
  return {
    id: "n1",
    type: "rect",
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    ...extra,
  } as SceneNode;
}

afterEach(() => cleanup());

describe("toggleConstraintEdge", () => {
  it("min + pin end -> stretch", () => {
    expect(toggleConstraintEdge("min", "end")).toBe("stretch");
  });

  it("stretch + un-pin start -> max", () => {
    expect(toggleConstraintEdge("stretch", "start")).toBe("max");
  });

  it("min + un-pin start -> center", () => {
    expect(toggleConstraintEdge("min", "start")).toBe("center");
  });

  it("scale + pin start -> min (starts fresh)", () => {
    expect(toggleConstraintEdge("scale", "start")).toBe("min");
  });

  it("scale + pin end -> max (starts fresh)", () => {
    expect(toggleConstraintEdge("scale", "end")).toBe("max");
  });
});

describe("<ConstraintsSection />", () => {
  it("defaults to min/min (pinned left/top) when the node has no constraints", () => {
    render(<ConstraintsSection node={makeNode()} onUpdate={vi.fn()} />);
    expect(screen.getByLabelText("Pin left").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Pin top").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Pin right").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByLabelText("Pin bottom").getAttribute("aria-pressed")).toBe("false");
  });

  it("clicking the right pin turns horizontal into stretch", () => {
    const onUpdate = vi.fn();
    render(<ConstraintsSection node={makeNode()} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByLabelText("Pin right"));
    expect(onUpdate).toHaveBeenCalledWith({
      constraints: { horizontal: "stretch", vertical: "min" },
    });
  });

  it("reflects an existing stretch/center constraint on the pins", () => {
    render(
      <ConstraintsSection
        node={makeNode({ constraints: { horizontal: "stretch", vertical: "center" } })}
        onUpdate={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Pin left").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Pin right").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Pin top").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByLabelText("Pin bottom").getAttribute("aria-pressed")).toBe("false");
  });

  it("shows the current mode (including scale/center) in the H/V dropdowns", () => {
    render(
      <ConstraintsSection
        node={makeNode({ constraints: { horizontal: "scale", vertical: "center" } })}
        onUpdate={vi.fn()}
      />,
    );
    const selects = screen.getAllByRole("combobox");
    expect(selects[0].textContent).toContain("Scale");
    expect(selects[1].textContent).toContain("Center");
  });
});
