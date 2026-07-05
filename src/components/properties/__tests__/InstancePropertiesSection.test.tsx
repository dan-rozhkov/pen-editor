import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { InstancePropertiesSection } from "../InstancePropertiesSection";
import { useSceneStore } from "@/store/sceneStore";
import { resetStores } from "@/test/fixtures";
import type { ComponentPropertyDef, FlatSceneNode, FrameNode, RefNode } from "@/types/scene";

const showIconProp: ComponentPropertyDef = {
  id: "showIcon",
  name: "Show icon",
  type: "boolean",
  defaultValue: true,
  bindingPath: "icon",
  bindingProp: "visible",
};

const labelProp: ComponentPropertyDef = {
  id: "label",
  name: "Label",
  type: "text",
  defaultValue: "Click me",
  bindingPath: "label",
  bindingProp: "text",
};

function seed(): void {
  const comp = {
    id: "comp",
    type: "frame",
    name: "Comp",
    reusable: true,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    properties: [showIconProp, labelProp],
  } as unknown as FlatSceneNode;

  const inst = {
    id: "inst",
    type: "ref",
    componentId: "comp",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
  } as unknown as FlatSceneNode;

  useSceneStore.setState({
    nodesById: { comp, inst },
    parentById: { comp: null, inst: null },
    childrenById: {},
    rootIds: ["comp", "inst"],
    componentArtifactsById: {},
    _cachedTree: null,
  });
}

afterEach(() => cleanup());

describe("<InstancePropertiesSection />", () => {
  beforeEach(() => resetStores());

  it("renders nothing when the component declares no properties", () => {
    const comp = { id: "comp", type: "frame", reusable: true, x: 0, y: 0, width: 10, height: 10, children: [] } as FrameNode;
    const inst = { id: "inst", type: "ref", componentId: "comp", x: 0, y: 0, width: 10, height: 10 } as RefNode;
    const { container } = render(<InstancePropertiesSection node={inst} component={comp} />);
    expect(container.textContent).toBe("");
  });

  it("renders a checkbox for a boolean property and a text input for a text property, toggling calls the store", () => {
    seed();
    const comp = useSceneStore.getState().getNodes().find((n) => n.id === "comp") as FrameNode;
    const inst = useSceneStore.getState().nodesById["inst"] as unknown as RefNode;

    render(<InstancePropertiesSection node={inst} component={comp} />);

    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true); // default value

    fireEvent.click(checkbox);
    const updated = useSceneStore.getState().nodesById["inst"] as unknown as RefNode;
    expect(updated.propertyValues).toEqual({ showIcon: false });

    const textInput = screen.getByDisplayValue("Click me");
    fireEvent.change(textInput, { target: { value: "Buy now" } });
    const updated2 = useSceneStore.getState().nodesById["inst"] as unknown as RefNode;
    expect(updated2.propertyValues).toEqual({ showIcon: false, label: "Buy now" });
  });
});
