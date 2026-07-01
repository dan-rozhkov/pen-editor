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

  it("shows only the enable toggle when no shader is set", () => {
    render(<ShaderSection node={rect()} onUpdate={vi.fn()} />);
    expect(screen.getByLabelText("Enable shader")).toBeTruthy();
    expect(screen.queryByTestId("shader-controls")).toBeNull();
  });

  it("enabling the toggle adds a default shader config", () => {
    const onUpdate = vi.fn();
    render(<ShaderSection node={rect()} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByLabelText("Enable shader"));
    expect(onUpdate).toHaveBeenCalledWith({
      shader: expect.objectContaining({ kind: "meshGradient" }),
    });
  });

  it("disabling the toggle clears the shader", () => {
    const onUpdate = vi.fn();
    render(
      <ShaderSection
        node={rect({ shader: { kind: "meshGradient", preset: "Default", params: {} } })}
        onUpdate={onUpdate}
      />,
    );
    fireEvent.click(screen.getByLabelText("Enable shader"));
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
