import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ComponentPropertiesSection } from "../ComponentPropertiesSection";
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

  useSceneStore.setState({
    nodesById: { comp },
    parentById: { comp: null },
    childrenById: {},
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

    fireEvent.click(screen.getByText("Add Property"));

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

    fireEvent.click(screen.getByTitle("Remove property"));

    const updated = useSceneStore.getState().nodesById["comp"] as FlatFrameNode;
    expect(updated.properties).toEqual([]);
  });
});
