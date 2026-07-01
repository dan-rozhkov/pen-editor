import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ShaderSection } from "../ShaderSection";
import type { SceneNode } from "@/types/scene";

const rect = (over: Partial<SceneNode> = {}): SceneNode =>
  ({ id: "r1", type: "rect", x: 0, y: 0, width: 100, height: 100, ...over }) as SceneNode;

describe("<ShaderSection />", () => {
  afterEach(() => cleanup());

  it("returns null for unsupported node types", () => {
    const { container } = render(
      <ShaderSection node={rect({ type: "line" }) as SceneNode} onUpdate={vi.fn()} />,
    );
    expect(container.querySelector('[data-testid="shader-controls"]')).toBeNull();
    expect(container.textContent).not.toContain("Shader");
  });

  it("shows only the add button when no shader is set", () => {
    render(<ShaderSection node={rect()} onUpdate={vi.fn()} />);
    expect(screen.getByTitle("Add shader")).toBeTruthy();
    expect(screen.queryByTestId("shader-controls")).toBeNull();
  });

  it("clicking the add button adds a default shader config", () => {
    const onUpdate = vi.fn();
    render(<ShaderSection node={rect()} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByTitle("Add shader"));
    expect(onUpdate).toHaveBeenCalledWith({
      shader: expect.objectContaining({ kind: "meshGradient" }),
    });
  });

  it("clicking the remove button clears the shader", () => {
    const onUpdate = vi.fn();
    render(
      <ShaderSection
        node={rect({ shader: { kind: "meshGradient", preset: "Default", params: {} } })}
        onUpdate={onUpdate}
      />,
    );
    fireEvent.click(screen.getByTitle("Remove shader"));
    expect(onUpdate).toHaveBeenCalledWith({ shader: undefined });
  });

  it("renders the controls block when a shader is set", () => {
    render(
      <ShaderSection
        node={rect({ shader: { kind: "meshGradient", preset: "Default", params: {} } })}
        onUpdate={vi.fn()}
      />,
    );
    expect(screen.getByTestId("shader-controls")).toBeTruthy();
  });
});
