import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DevExportSection } from "../DevExportSection";
import { useDevExportStore } from "@/store/devExportStore";
import { useCanvasRefStore } from "@/store/canvasRefStore";
import { useExportPresetStore } from "@/store/exportPresetStore";
import { useSceneStore } from "@/store/sceneStore";
import { ReadOnlyProvider } from "@/components/ReadOnlyProvider";
import * as exportSettingsUtils from "@/utils/exportSettingsUtils";

/**
 * `SelectInput`'s underlying base-ui `Select` only commits a click on an
 * *unhighlighted* option when the pointer type is "touch" (see
 * `SelectItem.js`'s `onClick`/`onMouseUp` guards) — a bare `fireEvent.click`
 * on the option is silently ignored. Firing `mouseMove` first highlights the
 * option (via `onMouseMove`/hover), which is what a real click-drag or
 * mouse-move-then-click does in the browser and lets the subsequent click
 * commit the selection.
 */
function selectOption(name: string) {
  const option = screen.getByRole("option", { name });
  fireEvent.mouseMove(option);
  fireEvent.click(option);
}

vi.mock("@/lib/exportSettings/runExportAll", () => ({
  runExportSettingsForNode: vi.fn(async () => [
    { settingId: "a", format: "png", filename: "a.png", success: true },
  ]),
}));

beforeEach(() => {
  useDevExportStore.setState({ overrides: {} });
  useCanvasRefStore.setState({ pixiRefs: null });
  useExportPresetStore.setState({ presets: [] });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("<DevExportSection />", () => {
  it("shows a default PNG 1x row for a node with no exportSettings and no override", () => {
    render(<DevExportSection nodeId="n1" nodeName="Icon" exportSettings={undefined} />);
    expect(screen.getByTestId("export-settings-list").children).toHaveLength(1);
    expect(screen.getByText("Export all")).toBeTruthy();
  });

  it("shows the node's own exportSettings as-is when untouched in Dev Mode", () => {
    render(
      <DevExportSection
        nodeId="n1"
        nodeName="Icon"
        exportSettings={[
          { id: "a", format: "png", scale: 1 },
          { id: "b", format: "svg", scale: 2 },
        ]}
      />,
    );
    expect(screen.getByTestId("export-settings-list").children).toHaveLength(2);
  });

  it("adding a row in Dev Mode writes to devExportStore, not a document callback", () => {
    render(<DevExportSection nodeId="n1" nodeName="Icon" exportSettings={[{ id: "a", format: "png", scale: 1 }]} />);

    fireEvent.click(screen.getByLabelText("Add export setting"));

    expect(useDevExportStore.getState().overrides.n1).toHaveLength(2);
  });

  it("once overridden, the node's own exportSettings no longer affect what's shown", () => {
    useDevExportStore.setState({ overrides: { n1: [{ id: "z", format: "webp", scale: 3 }] } });
    render(
      <DevExportSection
        nodeId="n1"
        nodeName="Icon"
        exportSettings={[{ id: "a", format: "png", scale: 1 }]}
      />,
    );
    expect(screen.getByTestId("export-settings-list").children).toHaveLength(1);
    expect(screen.getAllByText("WebP")).toHaveLength(1);
  });

  it("removing the only row in Dev Mode overrides down to an explicitly-empty list, showing zero rows — no default resurrected (finding 5)", () => {
    useDevExportStore.setState({ overrides: { n1: [{ id: "a", format: "png", scale: 1 }] } });
    render(<DevExportSection nodeId="n1" nodeName="Icon" exportSettings={undefined} />);

    fireEvent.click(screen.getByLabelText("Remove export setting"));

    expect(useDevExportStore.getState().overrides.n1).toEqual([]);
    expect(screen.queryByTestId("export-settings-list")).toBeNull();
    expect(screen.queryByText("Export all")).toBeNull();
  });

  it("does not mint a new default-row id on every recompute for the same untouched node (finding 5)", () => {
    const spy = vi.spyOn(exportSettingsUtils, "createExportSetting");
    const { rerender } = render(
      <DevExportSection nodeId="n1" nodeName="Icon" exportSettings={undefined} />,
    );
    expect(spy).toHaveBeenCalledTimes(1);

    // Simulate unrelated re-renders that still leave this node's settings
    // conceptually untouched/empty, including a content-equal but new
    // `exportSettings` array reference — the default row's identity must
    // come from a per-nodeId cache, not from re-deriving it every recompute.
    rerender(<DevExportSection nodeId="n1" nodeName="Icon" exportSettings={[]} />);
    rerender(<DevExportSection nodeId="n1" nodeName="Icon" exportSettings={undefined} />);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("resets export status when the nodeId prop changes, so a stale result doesn't leak to the next node (finding 3)", async () => {
    const { rerender } = render(
      <DevExportSection nodeId="n1" nodeName="Icon" exportSettings={[{ id: "a", format: "png", scale: 1 }]} />,
    );

    fireEvent.click(screen.getByText("Export all"));
    await screen.findByText("Exported 1 file.");

    rerender(
      <DevExportSection nodeId="n2" nodeName="Other" exportSettings={[{ id: "b", format: "png", scale: 1 }]} />,
    );

    expect(screen.queryByText("Exported 1 file.")).toBeNull();
  });

  // Ship-blocking bug: Dev Mode's real production tree wraps `<RightPanel />`
  // (and thus this section) in `<ReadOnlyProvider value={true}>`
  // (App.tsx:139, `isView || isDev`). Every SelectInput/TextInput in
  // PropertyInputs.tsx early-returns its onChange under that context, so
  // without an explicit opt-out the format/scale selects and the
  // suffix/custom-scale fields below are permanently inert in real Dev Mode
  // even though every other test in this file (rendering the section bare)
  // passes. These two tests reproduce the production wrapper and must stay
  // green — they went red before the `ReadOnlyProvider value={false}` opt-out
  // was added around this section.
  describe("under the real production ReadOnlyProvider(true) wrapper", () => {
    it("the scale select is interactive — Dev Mode opts out of read-only for this section", () => {
      render(
        <ReadOnlyProvider value={true}>
          <DevExportSection
            nodeId="n1"
            nodeName="Icon"
            exportSettings={[{ id: "a", format: "png", scale: 1 }]}
          />
        </ReadOnlyProvider>,
      );

      const [, scaleCombobox] = screen.getAllByRole("combobox");
      fireEvent.click(scaleCombobox);
      selectOption("2x");

      expect(useDevExportStore.getState().overrides.n1?.[0]).toMatchObject({ scale: 2 });
      // The document itself must stay untouched — Dev Mode's opt-out is only
      // legitimate because this section never writes to the node/.pen file.
      expect(useSceneStore.getState().nodesById.n1).toBeUndefined();
    });

    it("the format select is interactive — Dev Mode opts out of read-only for this section", () => {
      render(
        <ReadOnlyProvider value={true}>
          <DevExportSection
            nodeId="n1"
            nodeName="Icon"
            exportSettings={[{ id: "a", format: "png", scale: 1 }]}
          />
        </ReadOnlyProvider>,
      );

      const [formatCombobox] = screen.getAllByRole("combobox");
      fireEvent.click(formatCombobox);
      selectOption("JPG");

      expect(useDevExportStore.getState().overrides.n1?.[0]).toMatchObject({ format: "jpg" });
    });

    it("the suffix field in the settings popover is interactive", () => {
      render(
        <ReadOnlyProvider value={true}>
          <DevExportSection
            nodeId="n1"
            nodeName="Icon"
            exportSettings={[{ id: "a", format: "png", scale: 1 }]}
          />
        </ReadOnlyProvider>,
      );

      fireEvent.click(screen.getByTitle("Export settings"));
      fireEvent.change(screen.getByPlaceholderText("@2x, _dark, ..."), {
        target: { value: "@2x" },
      });

      expect(useDevExportStore.getState().overrides.n1?.[0]).toMatchObject({ suffix: "@2x" });
    });

    it("the custom-scale field in the settings popover is interactive", () => {
      render(
        <ReadOnlyProvider value={true}>
          <DevExportSection
            nodeId="n1"
            nodeName="Icon"
            exportSettings={[{ id: "a", format: "png", scale: 1.5 }]}
          />
        </ReadOnlyProvider>,
      );

      fireEvent.click(screen.getByTitle("Export settings"));
      fireEvent.change(screen.getByPlaceholderText("e.g. 1.5"), { target: { value: "4" } });

      expect(useDevExportStore.getState().overrides.n1?.[0]).toMatchObject({ scale: 4 });
    });
  });
});
