import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PropertiesPanel } from "../PropertiesPanel";
import { useSelectionStore } from "@/store/selectionStore";
import { useSceneStore } from "@/store/sceneStore";
import { useDrawModeStore } from "@/store/drawModeStore";
import type { FlatSceneNode } from "@/types/scene";
import { resetStores, seedScene } from "@/test/fixtures";

/**
 * PropertiesPanel is the orchestrator: given the current selection (count,
 * node type), the active draw tool and instance context, it decides WHICH
 * property surface to render — page properties, the single-node PropertyEditor,
 * the MultiSelectPropertyEditor, the descendant editor, frame presets, etc.
 *
 * These tests are about routing, not about each section's internals. The heavy
 * leaf surfaces are mocked to thin shims that render an identifiable marker so
 * we can assert which one the orchestrator chose. The real PropertyEditor sub-
 * editors (PositionSection, FillSection, …) are exercised by their own tests.
 */

vi.mock("@/components/properties/PropertyEditor", () => ({
  PropertyEditor: ({ node, beforeExport }: { node: { id: string; type: string }; beforeExport?: ReactNode }) => (
    <div data-testid="property-editor" data-node-id={node.id} data-node-type={node.type}>
      <div data-testid="embed-section" />
      {beforeExport}
      <div data-testid="export-section" />
    </div>
  ),
}));
vi.mock("@/components/properties/MultiSelectPropertyEditor", () => ({
  MultiSelectPropertyEditor: ({ selectedNodes }: { selectedNodes: { id: string }[] }) => (
    <div data-testid="multi-select-editor" data-count={selectedNodes.length} />
  ),
}));
vi.mock("@/components/properties/DescendantPropertyEditor", () => ({
  DescendantPropertyEditor: () => <div data-testid="descendant-editor" />,
}));
vi.mock("@/components/properties/PageProperties", () => ({
  PageProperties: () => <div data-testid="page-properties" />,
}));
vi.mock("@/components/properties/PencilToolProperties", () => ({
  PencilToolProperties: () => <div data-testid="pencil-properties" />,
}));
vi.mock("@/components/properties/AlignmentSection", () => ({
  SpacingSection: () => <div data-testid="spacing-section" />,
}));
vi.mock("@/components/properties/PrototypeExportSection", () => ({
  PrototypeExportSection: () => <div data-testid="prototype-section" />,
}));
vi.mock("@/components/properties/ShowcasePublishSection", () => ({
  ShowcasePublishSection: () => <div data-testid="showcase-section" />,
}));

function select(ids: string[]) {
  useSelectionStore.setState({ selectedIds: ids });
}

function seedShowcaseEmbeds() {
  const first = {
    id: "embed1",
    type: "embed",
    name: "First screen",
    x: 0,
    y: 0,
    width: 390,
    height: 844,
    htmlContent: "<main>First</main>",
  } as FlatSceneNode;
  const second = {
    ...first,
    id: "embed2",
    name: "Second screen",
    x: 420,
    htmlContent: "<main>Second</main>",
  } as FlatSceneNode;

  useSceneStore.setState({
    nodesById: { embed1: first, embed2: second },
    parentById: { embed1: null, embed2: null },
    childrenById: {},
    rootIds: ["embed1", "embed2"],
    _cachedTree: null,
  });
}

describe("<PropertiesPanel /> (orchestration)", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
    useDrawModeStore.setState({ activeTool: null });
  });

  afterEach(() => cleanup());

  describe("empty selection", () => {
    it("shows page properties and no node editors", () => {
      render(<PropertiesPanel />);

      expect(screen.getByTestId("page-properties")).toBeTruthy();

      expect(screen.queryByTestId("property-editor")).toBeNull();
      expect(screen.queryByTestId("multi-select-editor")).toBeNull();
      expect(screen.queryByTestId("spacing-section")).toBeNull();
    });
  });

  describe("single selection", () => {
    it("places Showcase after Embed and before Export for a single embed", () => {
      seedShowcaseEmbeds();
      select(["embed1"]);
      render(<PropertiesPanel />);

      const embed = screen.getByTestId("embed-section");
      const showcase = screen.getByTestId("showcase-section");
      const exportSection = screen.getByTestId("export-section");
      expect(embed.compareDocumentPosition(showcase) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(showcase.compareDocumentPosition(exportSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("routes a single root frame to the PropertyEditor", () => {
      select(["frame1"]);
      render(<PropertiesPanel />);

      const editor = screen.getByTestId("property-editor");
      expect(editor.getAttribute("data-node-id")).toBe("frame1");
      expect(editor.getAttribute("data-node-type")).toBe("frame");

      // Single selection -> no multi-select editor, no page props.
      expect(screen.queryByTestId("multi-select-editor")).toBeNull();
      expect(screen.queryByTestId("page-properties")).toBeNull();
    });

    it("routes a single text node to the PropertyEditor with its type", () => {
      select(["text1"]);
      render(<PropertiesPanel />);

      const editor = screen.getByTestId("property-editor");
      expect(editor.getAttribute("data-node-id")).toBe("text1");
      expect(editor.getAttribute("data-node-type")).toBe("text");
    });

    it("routes a child node not inside auto-layout to the PropertyEditor", () => {
      // Alignment is rendered inside PositionSection by PropertyEditor.
      select(["rect1"]);
      render(<PropertiesPanel />);

      expect(screen.getByTestId("property-editor")).toBeTruthy();
    });

    it("does not show spacing for a single root-level node", () => {
      select(["rect2"]);
      render(<PropertiesPanel />);

      expect(screen.queryByTestId("spacing-section")).toBeNull();
      expect(screen.getByTestId("property-editor")).toBeTruthy();
    });
  });

  describe("multi selection", () => {
    it("keeps Showcase at the bottom after Prototype for multiple embeds", () => {
      seedShowcaseEmbeds();
      select(["embed1", "embed2"]);
      render(<PropertiesPanel />);

      const prototype = screen.getByTestId("prototype-section");
      const showcase = screen.getByTestId("showcase-section");
      expect(prototype.compareDocumentPosition(showcase) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("routes 2+ nodes to the MultiSelectPropertyEditor plus spacing controls", () => {
      select(["rect1", "text1"]);
      render(<PropertiesPanel />);

      const multi = screen.getByTestId("multi-select-editor");
      expect(multi.getAttribute("data-count")).toBe("2");

      expect(screen.getByTestId("spacing-section")).toBeTruthy();

      // Multi-select must NOT render the single-node editor or page props.
      expect(screen.queryByTestId("property-editor")).toBeNull();
      expect(screen.queryByTestId("page-properties")).toBeNull();
    });
  });

  describe("instance context", () => {
    it("routes to the DescendantPropertyEditor when an instance context is active", () => {
      select(["rect1"]);
      useSelectionStore.setState({
        instanceContext: {
          instanceId: "rect1",
          descendantPath: "rect1",
        },
      });
      render(<PropertiesPanel />);

      expect(screen.getByTestId("descendant-editor")).toBeTruthy();
      // The normal single-node editor is suppressed while an instance context exists.
      expect(screen.queryByTestId("property-editor")).toBeNull();
    });
  });

  describe("active draw tools", () => {
    it("shows the frame presets panel when the frame tool is active", () => {
      useDrawModeStore.setState({ activeTool: "frame" });
      render(<PropertiesPanel />);

      expect(screen.getByText("Frame Presets")).toBeTruthy();
      // Page properties are suppressed under the frame tool.
      expect(screen.queryByTestId("page-properties")).toBeNull();
    });

    it("suppresses the editor surfaces under the frame tool even with a selection", () => {
      useDrawModeStore.setState({ activeTool: "frame" });
      select(["frame1"]);
      render(<PropertiesPanel />);

      expect(screen.getByText("Frame Presets")).toBeTruthy();
      expect(screen.queryByTestId("property-editor")).toBeNull();
      expect(screen.queryByTestId("multi-select-editor")).toBeNull();
    });

    it("shows pencil tool properties when the pencil tool is active with no selection", () => {
      useDrawModeStore.setState({ activeTool: "pencil" });
      render(<PropertiesPanel />);

      expect(screen.getByTestId("pencil-properties")).toBeTruthy();
      // No page properties while the pencil tool owns the panel.
      expect(screen.queryByTestId("page-properties")).toBeNull();
    });
  });
});
