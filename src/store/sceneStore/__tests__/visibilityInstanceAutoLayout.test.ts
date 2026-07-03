import { describe, it, expect, beforeEach } from "vitest";
import type { FlatSceneNode } from "@/types/scene";
import { useSceneStore } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { getNodeEffectiveSize } from "@/utils/nodeUtils";
import { resetStores } from "@/test/fixtures";

/**
 * Regression coverage for the COMPONENT-INSTANCE path of the visibility bug.
 *
 * Structure:
 *   comp  (reusable frame, column auto-layout, height=fit_content, gap 0, no pad)
 *     ├─ c1 (rect h=40)
 *     └─ c2 (rect h=40)
 *   inst  (ref -> comp)
 *
 * Hiding a descendant of the INSTANCE is done via updateInstanceOverride
 * (LayerItem's eye toggle for instance descendants), NOT toggleVisibility.
 * The instance's effective (fit_content) height should shrink 80 -> 40.
 */

function effectiveHeightOf(id: string): number {
  const calc = useLayoutStore.getState().calculateLayoutForFrame;
  const nodes = useSceneStore.getState().getNodes();
  const size = getNodeEffectiveSize(nodes, id, calc);
  return size!.height;
}

function seedInstance(): void {
  const comp = {
    id: "comp",
    type: "frame",
    name: "Comp",
    reusable: true,
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    layout: {
      autoLayout: true,
      flexDirection: "column",
      gap: 0,
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
    },
    sizing: { widthMode: "fixed", heightMode: "fit_content" },
  } as unknown as FlatSceneNode;

  const mk = (id: string) =>
    ({
      id,
      type: "rect",
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      sizing: { widthMode: "fixed", heightMode: "fixed" },
    } as unknown as FlatSceneNode);

  const inst = {
    id: "inst",
    type: "ref",
    name: "Instance",
    x: 400,
    y: 0,
    width: 100,
    height: 80,
    componentId: "comp",
  } as unknown as FlatSceneNode;

  useSceneStore.setState({
    nodesById: { comp, c1: mk("c1"), c2: mk("c2"), inst },
    parentById: { comp: null, c1: "comp", c2: "comp", inst: null },
    childrenById: { comp: ["c1", "c2"] },
    rootIds: ["comp", "inst"],
    componentArtifactsById: {},
    _cachedTree: null,
  });
}

describe("visibility override resizes auto-layout instance (model level)", () => {
  beforeEach(() => {
    resetStores();
    seedInstance();
  });

  it("[instance] fit-height instance shrinks when a descendant is hidden via override", () => {
    expect(effectiveHeightOf("inst")).toBe(80);

    // path for a direct child of the component == the child's id
    useSceneStore
      .getState()
      .updateInstanceOverride("inst", "c1", { visible: false });

    // sanity: the override actually landed
    const inst = useSceneStore.getState().nodesById["inst"] as {
      overrides?: Record<string, unknown>;
    };
    expect(inst.overrides?.["c1"]).toBeTruthy();

    expect(effectiveHeightOf("inst")).toBe(40);
  });

  it("[instance-enabled control] fit-height instance shrinks when a descendant is disabled (known-working path)", () => {
    expect(effectiveHeightOf("inst")).toBe(80);
    useSceneStore
      .getState()
      .updateInstanceOverride("inst", "c1", { enabled: false });
    expect(effectiveHeightOf("inst")).toBe(40);
  });
});
