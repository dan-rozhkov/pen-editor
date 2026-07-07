import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TypeSection } from "../TypeSection";
import type { SceneNode } from "@/types/scene";

function makeNode(extra: Partial<SceneNode> = {}): SceneNode {
  return {
    id: "n1",
    type: "rect",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    ...extra,
  } as SceneNode;
}

afterEach(() => cleanup());

describe("<TypeSection />", () => {
  it("renders an inactive mask toggle by default", () => {
    render(<TypeSection node={makeNode()} onUpdate={vi.fn()} />);

    const button = screen.getByRole("button", { name: "Use as mask" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("renders an active mask toggle when node.isMask is true", () => {
    render(<TypeSection node={makeNode({ isMask: true } as Partial<SceneNode>)} onUpdate={vi.fn()} />);

    const button = screen.getByRole("button", { name: "Disable mask" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("toggles isMask on via the mask button", () => {
    const onUpdate = vi.fn();
    render(<TypeSection node={makeNode()} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByRole("button", { name: "Use as mask" }));

    expect(onUpdate).toHaveBeenCalledWith({ isMask: true });
  });

  it("toggles isMask off via the mask button", () => {
    const onUpdate = vi.fn();
    render(<TypeSection node={makeNode({ isMask: true } as Partial<SceneNode>)} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByRole("button", { name: "Disable mask" }));

    expect(onUpdate).toHaveBeenCalledWith({ isMask: false });
  });

  it("does not render the mask toggle for connector nodes", () => {
    render(<TypeSection node={makeNode({ type: "connector" })} onUpdate={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Use as mask" })).toBeNull();
  });
});
