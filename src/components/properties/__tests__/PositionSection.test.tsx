import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PositionSection } from "../PositionSection";
import { ReadOnlyProvider } from "@/components/ReadOnlyProvider";
import { useHistoryStore } from "@/store/historyStore";
import { resetStores } from "@/test/fixtures";
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

beforeEach(() => resetStores());
afterEach(() => cleanup());

describe("<PositionSection />", () => {
  it("renders X, Y and rotation values from the node", () => {
    render(<PositionSection node={makeNode({ rotation: 45 })} onUpdate={vi.fn()} />);
    const inputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    expect(inputs[0].value).toBe("10"); // X
    expect(inputs[1].value).toBe("20"); // Y
    expect(inputs[2].value).toBe("45"); // rotation
  });

  it("calls onUpdate with the new X and Y on edit", () => {
    const onUpdate = vi.fn();
    render(<PositionSection node={makeNode()} onUpdate={onUpdate} />);
    const inputs = screen.getAllByRole("spinbutton");

    fireEvent.focus(inputs[0]);
    fireEvent.change(inputs[0], { target: { value: "42" } });
    fireEvent.blur(inputs[0]);
    expect(onUpdate).toHaveBeenCalledWith({ x: 42 });

    fireEvent.focus(inputs[1]);
    fireEvent.change(inputs[1], { target: { value: "-5" } });
    fireEvent.blur(inputs[1]);
    expect(onUpdate).toHaveBeenCalledWith({ y: -5 });
  });

  it("calls onUpdate with a parsed rotation", () => {
    const onUpdate = vi.fn();
    render(<PositionSection node={makeNode()} onUpdate={onUpdate} />);
    const inputs = screen.getAllByRole("spinbutton");

    fireEvent.change(inputs[2], { target: { value: "90" } });
    expect(onUpdate).toHaveBeenCalledWith({ rotation: 90 });
  });

  it("shows a Mixed placeholder and empty value for mixed keys", () => {
    render(
      <PositionSection
        node={makeNode()}
        onUpdate={vi.fn()}
        mixedKeys={new Set(["x", "rotation"])}
      />,
    );
    const inputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    expect(inputs[0].value).toBe("");
    expect(inputs[0].placeholder).toBe("Mixed");
    expect(inputs[1].value).toBe("20"); // Y not mixed
    expect(inputs[2].value).toBe(""); // rotation mixed
  });

  it("toggles flipX / flipY via the flip buttons", () => {
    const onUpdate = vi.fn();
    render(<PositionSection node={makeNode({ flipX: false, flipY: true })} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByTitle("Flip horizontal"));
    expect(onUpdate).toHaveBeenCalledWith({ flipX: true });

    fireEvent.click(screen.getByTitle("Flip vertical"));
    expect(onUpdate).toHaveBeenCalledWith({ flipY: false });
  });

  it("does not fire onUpdate when editing rotation in read-only mode", () => {
    const onUpdate = vi.fn();
    // value is out-of-range so a clamp-on-commit would actually change it if
    // the readOnly guard were missing (see PropertyInputs.readonly.test.tsx).
    render(
      <ReadOnlyProvider value={true}>
        <PositionSection node={makeNode({ rotation: 400 })} onUpdate={onUpdate} />
      </ReadOnlyProvider>,
    );
    const inputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    const rotationInput = inputs[2];
    fireEvent.focus(rotationInput);
    fireEvent.keyDown(rotationInput, { key: "Enter" });
    fireEvent.change(rotationInput, { target: { value: "90" } });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("collapses a rotation editing session into a single undo entry", () => {
    const onUpdate = vi.fn();
    render(<PositionSection node={makeNode({ rotation: 0 })} onUpdate={onUpdate} />);
    const inputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    const rotationInput = inputs[2];

    fireEvent.focus(rotationInput);
    fireEvent.change(rotationInput, { target: { value: "45" } });
    fireEvent.change(rotationInput, { target: { value: "90" } });
    expect(onUpdate.mock.calls).toEqual([[{ rotation: 45 }], [{ rotation: 90 }]]);
    expect(useHistoryStore.getState().batchMode).toBe(true);
    fireEvent.blur(rotationInput);
    expect(useHistoryStore.getState().batchMode).toBe(false);
    expect(useHistoryStore.getState().past).toHaveLength(1);
  });

  it("hides the absolute-position checkbox outside auto-layout", () => {
    render(<PositionSection node={makeNode()} onUpdate={vi.fn()} />);
    expect(screen.queryByText("Absolute position")).toBeNull();
  });

  it("shows and toggles the absolute-position checkbox inside auto-layout", () => {
    const onUpdate = vi.fn();
    render(
      <PositionSection
        node={makeNode({ absolutePosition: false } as Partial<SceneNode>)}
        onUpdate={onUpdate}
        parentContext={{ isInsideAutoLayout: true } as never}
      />,
    );
    expect(screen.getByText("Absolute position")).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(onUpdate).toHaveBeenCalledWith({ absolutePosition: true });
  });
});
