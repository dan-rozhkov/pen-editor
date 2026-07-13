import type { FlatSceneNode } from "@/types/scene";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useHistoryStore } from "@/store/historyStore";
import { useVariableStore } from "@/store/variableStore";
import { useTextStyleStore } from "@/store/textStyleStore";
import { useStyleStore } from "@/store/styleStore";
import { useThemeStore } from "@/store/themeStore";
import { useViewportStore } from "@/store/viewportStore";
import { useGuidesStore } from "@/store/guidesStore";

/** Reset every store the tool handlers touch to a clean baseline. */
export function resetStores(): void {
  useSceneStore.setState({
    nodesById: {},
    parentById: {},
    childrenById: {},
    rootIds: [],
    componentArtifactsById: {},
    _cachedTree: null,
    expandedFrameIds: new Set<string>(),
    pageBackground: "#f5f5f5",
    slideOrder: [],
  });
  useSelectionStore.setState({
    selectedIds: [],
    editingNodeId: null,
    editingMode: null,
    editingInstanceId: null,
    instanceContext: null,
    enteredContainerId: null,
    enteredInstanceDescendantPath: null,
    lastSelectedId: null,
  });
  useHistoryStore.setState({ past: [], future: [], batchMode: false, batchDepth: 0 });
  useVariableStore.setState({ variables: [] });
  useTextStyleStore.setState({ textStyles: [] });
  useStyleStore.setState({ fillStyles: [], effectStyles: [] });
  useThemeStore.setState({ activeTheme: "light" });
  useViewportStore.setState({ scale: 1, x: 0, y: 0 });
  useGuidesStore.setState({ guides: [] });
}

/**
 * Fixture scene graph:
 *
 *   frame1 "Screen" (100,100 400x300, fill #ffffff)
 *     ├─ rect1 "Box" (10,20 100x50, fill #ff0000, strokeWidth 1, cornerRadius 4)
 *     └─ text1 "Title" (10,90 80x20, "Hello", fontSize 16)
 *   rect2 "Floating" (600,100 200x100, fill #00ff00)
 */
export function seedScene(): void {
  const frame1 = {
    id: "frame1",
    type: "frame",
    name: "Screen",
    x: 100,
    y: 100,
    width: 400,
    height: 300,
    fill: "#ffffff",
    layout: { autoLayout: false, gap: 8, paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16 },
  } as unknown as FlatSceneNode;

  const rect1 = {
    id: "rect1",
    type: "rect",
    name: "Box",
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    fill: "#ff0000",
    strokeWidth: 1,
    cornerRadius: 4,
  } as unknown as FlatSceneNode;

  const text1 = {
    id: "text1",
    type: "text",
    name: "Title",
    x: 10,
    y: 90,
    width: 80,
    height: 20,
    text: "Hello",
    fontSize: 16,
    fontFamily: "Arial",
    fill: "#000000",
  } as unknown as FlatSceneNode;

  const rect2 = {
    id: "rect2",
    type: "rect",
    name: "Floating",
    x: 600,
    y: 100,
    width: 200,
    height: 100,
    fill: "#00ff00",
  } as unknown as FlatSceneNode;

  useSceneStore.setState({
    nodesById: { frame1, rect1, text1, rect2 },
    parentById: { frame1: null, rect1: "frame1", text1: "frame1", rect2: null },
    childrenById: { frame1: ["rect1", "text1"] },
    rootIds: ["frame1", "rect2"],
    componentArtifactsById: {},
    _cachedTree: null,
  });
}

export function seedVariables(): void {
  useVariableStore.setState({
    variables: [
      {
        id: "var-primary",
        name: "--primary",
        type: "color",
        value: "#3366ff",
        themeValues: { light: "#3366ff", dark: "#99bbff" },
      },
      {
        id: "var-radius",
        name: "--radius-m",
        type: "number",
        value: "8",
      },
    ],
  });
}

export function seedFillStyles(): void {
  useStyleStore.setState({
    fillStyles: [
      {
        id: "fillstyle-brand",
        name: "Brand/Primary",
        paint: { id: "p1", type: "solid", color: "#3366ff" },
      },
    ],
  });
}

export function seedEffectStyles(): void {
  useStyleStore.setState({
    effectStyles: [
      {
        id: "effectstyle-card",
        name: "Card/Shadow",
        effects: [
          {
            type: "shadow",
            shadowType: "outer",
            color: "#00000040",
            offset: { x: 0, y: 4 },
            blur: 8,
            spread: 0,
            id: "e1",
          },
        ],
      },
    ],
  });
}

export function seedTextStyles(): void {
  useTextStyleStore.setState({
    textStyles: [
      {
        id: "style-heading",
        name: "Heading/L",
        fontFamily: "Inter",
        fontSize: 32,
        fontWeight: "700",
        lineHeight: 1.1,
        letterSpacing: -0.5,
        textTransform: "none",
      },
    ],
  });
}
