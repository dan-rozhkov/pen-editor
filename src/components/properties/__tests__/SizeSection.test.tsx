import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SizeSection } from "../SizeSection";
import { useSceneStore } from "@/store/sceneStore";
import { resetStores, seedScene } from "@/test/fixtures";
import type { PolygonNode, SceneNode } from "@/types/scene";
import type { ParentContext } from "@/utils/nodeUtils";
import { generatePolygonPoints } from "@/utils/polygonUtils";

const ROOT_CONTEXT = { isInsideAutoLayout: false, parent: null } as unknown as ParentContext;

function sceneNode(id: string): SceneNode {
  return useSceneStore.getState().getNodes().find((n) => n.id === id)!;
}

describe("<SizeSection />", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
  });

  afterEach(() => cleanup());

  // rect2 is a plain 200x100 rect at the root (not inside auto-layout), so the
  // sizing-mode buttons are hidden and only the W/H inputs render.
  it("renders width and height from the node", () => {
    render(
      <SizeSection node={sceneNode("rect2")} onUpdate={vi.fn()} parentContext={ROOT_CONTEXT} />,
    );
    const inputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    expect(inputs[0].value).toBe("200"); // W
    expect(inputs[1].value).toBe("100"); // H
  });

  it("calls onUpdate when width or height is edited", () => {
    const onUpdate = vi.fn();
    render(
      <SizeSection node={sceneNode("rect2")} onUpdate={onUpdate} parentContext={ROOT_CONTEXT} />,
    );
    const inputs = screen.getAllByRole("spinbutton");

    fireEvent.change(inputs[0], { target: { value: "300" } });
    expect(onUpdate).toHaveBeenCalledWith({ width: 300 });

    fireEvent.change(inputs[1], { target: { value: "250" } });
    expect(onUpdate).toHaveBeenCalledWith({ height: 250 });
  });

  it("locks the aspect ratio and stores the current ratio", () => {
    const onUpdate = vi.fn();
    render(
      <SizeSection node={sceneNode("rect2")} onUpdate={onUpdate} parentContext={ROOT_CONTEXT} />,
    );
    fireEvent.click(screen.getByTitle("Lock aspect ratio"));
    expect(onUpdate).toHaveBeenCalledWith({ aspectRatioLocked: true, aspectRatio: 2 });
  });

  it("scales the other dimension when the aspect ratio is locked", () => {
    const onUpdate = vi.fn();
    const locked = {
      ...sceneNode("rect2"),
      aspectRatioLocked: true,
      aspectRatio: 2,
    } as SceneNode;
    render(<SizeSection node={locked} onUpdate={onUpdate} parentContext={ROOT_CONTEXT} />);
    const inputs = screen.getAllByRole("spinbutton");

    fireEvent.change(inputs[0], { target: { value: "300" } });
    // height = round(300 / 2) = 150
    expect(onUpdate).toHaveBeenCalledWith({ width: 300, height: 150 });
  });

  it("shows a Mixed placeholder for a mixed width", () => {
    render(
      <SizeSection
        node={sceneNode("rect2")}
        onUpdate={vi.fn()}
        parentContext={ROOT_CONTEXT}
        mixedKeys={new Set(["width"])}
      />,
    );
    const inputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    expect(inputs[0].value).toBe("");
    expect(inputs[0].placeholder).toBe("Mixed");
    expect(inputs[1].value).toBe("100"); // H not mixed
  });

  it("renders sizing-mode buttons for a frame and applies a width mode", () => {
    const onUpdate = vi.fn();
    render(
      <SizeSection node={sceneNode("frame1")} onUpdate={onUpdate} parentContext={ROOT_CONTEXT} />,
    );
    // Two rows of Fixed/Fill/Fit (W and H); the first "Fill" is the width mode.
    const fillButtons = screen.getAllByRole("button", { name: "Fill" });
    expect(fillButtons.length).toBeGreaterThanOrEqual(2);

    fireEvent.click(fillButtons[0]);
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sizing: expect.objectContaining({ widthMode: "fill_container" }),
      }),
    );
  });

  describe("min/max clamps", () => {
    const AUTO_LAYOUT_CONTEXT = {
      isInsideAutoLayout: true,
      parent: null,
    } as unknown as ParentContext;

    it("shows Min/Max inputs only when inside an auto-layout parent", () => {
      render(
        <SizeSection node={sceneNode("rect2")} onUpdate={vi.fn()} parentContext={ROOT_CONTEXT} />,
      );
      expect(screen.queryByText("Min / Max")).toBeNull();
    });

    it("renders Min/Max inputs from the node's sizing constraints", () => {
      const node = {
        ...sceneNode("rect2"),
        sizing: { minWidth: 50, maxWidth: 400, minHeight: 20, maxHeight: 200 },
      } as SceneNode;
      render(
        <SizeSection node={node} onUpdate={vi.fn()} parentContext={AUTO_LAYOUT_CONTEXT} />,
      );
      expect(screen.getByText("Min / Max")).toBeTruthy();
      const inputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
      // DOM order: W, H, Min W, Max W, Min H, Max H
      expect(inputs.map((i) => i.value)).toEqual(["200", "100", "50", "400", "20", "200"]);
    });

    it("updates sizing.maxWidth via its input", () => {
      const onUpdate = vi.fn();
      render(
        <SizeSection node={sceneNode("rect2")} onUpdate={onUpdate} parentContext={AUTO_LAYOUT_CONTEXT} />,
      );
      const inputs = screen.getAllByRole("spinbutton");
      fireEvent.change(inputs[3], { target: { value: "320" } }); // Max W
      expect(onUpdate).toHaveBeenCalledWith({
        sizing: expect.objectContaining({ maxWidth: 320 }),
      });
    });
  });

  describe("star (polygon with innerRadiusRatio) W/H edits", () => {
    function starNode(): PolygonNode {
      const sides = 5;
      const innerRadiusRatio = 0.5;
      return {
        id: "star1",
        type: "polygon",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        sides,
        innerRadiusRatio,
        points: generatePolygonPoints(sides, 100, 100, innerRadiusRatio),
      } as PolygonNode;
    }

    it("preserves innerRadiusRatio when W is edited (regenerates a star, not a plain pentagon)", () => {
      const onUpdate = vi.fn();
      const node = starNode();
      render(<SizeSection node={node} onUpdate={onUpdate} parentContext={ROOT_CONTEXT} />);
      const inputs = screen.getAllByRole("spinbutton");
      fireEvent.change(inputs[0], { target: { value: "150" } });

      const expectedPoints = generatePolygonPoints(5, 150, 100, 0.5);
      const call = onUpdate.mock.calls.find((c) => "points" in c[0]);
      expect(call?.[0].points).toEqual(expectedPoints);
      // A plain pentagon (no ratio) would produce different points.
      expect(call?.[0].points).not.toEqual(generatePolygonPoints(5, 150, 100));
    });

    it("preserves innerRadiusRatio when H is edited", () => {
      const onUpdate = vi.fn();
      const node = starNode();
      render(<SizeSection node={node} onUpdate={onUpdate} parentContext={ROOT_CONTEXT} />);
      const inputs = screen.getAllByRole("spinbutton");
      fireEvent.change(inputs[1], { target: { value: "150" } });

      const expectedPoints = generatePolygonPoints(5, 100, 150, 0.5);
      const call = onUpdate.mock.calls.find((c) => "points" in c[0]);
      expect(call?.[0].points).toEqual(expectedPoints);
      expect(call?.[0].points).not.toEqual(generatePolygonPoints(5, 100, 150));
    });
  });

  it("toggles clip content for frames only", () => {
    const onUpdate = vi.fn();
    const { unmount } = render(
      <SizeSection node={sceneNode("frame1")} onUpdate={onUpdate} parentContext={ROOT_CONTEXT} />,
    );
    expect(screen.getByText("Clip content")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onUpdate).toHaveBeenCalledWith({ clip: true });
    unmount();

    render(
      <SizeSection node={sceneNode("rect2")} onUpdate={vi.fn()} parentContext={ROOT_CONTEXT} />,
    );
    expect(screen.queryByText("Clip content")).toBeNull();
  });
});
