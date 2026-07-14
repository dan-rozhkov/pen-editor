import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ComponentPropertiesSection } from "../ComponentPropertiesSection";
import { getComponentPropertyTargetOptions } from "@/utils/componentPropertyTargets";
import { useSceneStore } from "@/store/sceneStore";
import { resetStores } from "@/test/fixtures";
import type { FlatFrameNode, FlatSceneNode, FrameNode } from "@/types/scene";

function seedComponent(): void {
  const comp = {
    id: "comp",
    type: "frame",
    name: "Comp",
    reusable: true,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
  } as unknown as FlatSceneNode;
  const label = {
    id: "label",
    type: "text",
    name: "Label",
    text: "Click me",
    x: 0,
    y: 0,
    width: 80,
    height: 20,
  } as unknown as FlatSceneNode;
  const nested = {
    id: "nested",
    type: "rect",
    name: "Icon background",
    x: 0,
    y: 0,
    width: 20,
    height: 20,
  } as unknown as FlatSceneNode;

  useSceneStore.setState({
    nodesById: { comp, label, nested },
    parentById: { comp: null, label: "comp", nested: "label" },
    childrenById: { comp: ["label"], label: ["nested"] },
    rootIds: ["comp"],
    componentArtifactsById: {},
    _cachedTree: null,
  });
}

afterEach(() => cleanup());

describe("<ComponentPropertiesSection />", () => {
  beforeEach(() => {
    resetStores();
    seedComponent();
  });

  it("adds a new property declaration to the reusable component", () => {
    const comp = useSceneStore.getState().nodesById["comp"] as unknown as FrameNode;
    render(<ComponentPropertiesSection node={comp} />);

    fireEvent.click(screen.getByLabelText("Add property"));

    const updated = useSceneStore.getState().nodesById["comp"] as FlatFrameNode;
    expect(updated.properties).toHaveLength(1);
    expect(updated.properties?.[0]).toMatchObject({ name: "Property 1", type: "text" });
  });

  it("removes a property when its delete button is clicked", () => {
    useSceneStore.getState().setComponentProperties("comp", [
      {
        id: "p1",
        name: "State",
        type: "variant",
        variantOptions: ["default", "hover"],
        defaultValue: "default",
        bindingPath: "label",
        bindingProp: "fill",
      },
    ]);
    const comp = useSceneStore.getState().nodesById["comp"] as unknown as FrameNode;
    render(<ComponentPropertiesSection node={comp} />);

    expect(screen.queryByText("Target node")).toBeNull();
    fireEvent.click(screen.getByLabelText("Remove property"));

    const updated = useSceneStore.getState().nodesById["comp"] as FlatFrameNode;
    expect(updated.properties).toEqual([]);
  });

  it("renames a property from the popover title on double-click", () => {
    useSceneStore.getState().setComponentProperties("comp", [
      {
        id: "p1",
        name: "State",
        type: "variant",
        variantOptions: ["default", "hover"],
        defaultValue: "default",
        bindingPath: "label",
        bindingProp: "fill",
      },
    ]);
    const comp = useSceneStore.getState().nodesById["comp"] as unknown as FrameNode;
    render(<ComponentPropertiesSection node={comp} />);

    fireEvent.click(screen.getByLabelText("Edit property State"));
    fireEvent.doubleClick(screen.getByTestId("property-popover-title"));
    fireEvent.change(screen.getByLabelText("Property name"), { target: { value: "Mode" } });
    fireEvent.blur(screen.getByLabelText("Property name"));

    const updated = useSceneStore.getState().nodesById["comp"] as FlatFrameNode;
    expect(updated.properties?.[0]?.name).toBe("Mode");
  });

  it("builds named target options while retaining ID paths as their values", () => {
    const state = useSceneStore.getState();
    const options = getComponentPropertyTargetOptions("comp", state.nodesById, state.childrenById);
    expect(options.map(({ value, label }) => ({ value, label }))).toEqual([
      { value: "label", label: "Label" },
      { value: "label/nested", label: "Icon background" },
    ]);
  });
});
