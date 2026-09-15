import { beforeEach, describe, expect, it, vi } from "vitest";
import { createKeyDownHandler, type KeyDownHandlerDeps } from "../keyboardCommands";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { sourcePathToShadowPath } from "@/lib/embedLayerTree";
import { resetStores } from "@/test/fixtures";
import type { FlatSceneNode } from "@/types/scene";

function makeDeps(): KeyDownHandlerDeps {
  return {
    dimensions: { width: 800, height: 600 },
    setIsSpacePressed: vi.fn(),
    setIsPanning: vi.fn(),
    deleteNode: vi.fn(),
    updateNode: vi.fn(),
    moveNode: vi.fn(),
    groupNodes: vi.fn(() => null),
    ungroupNodes: vi.fn(() => []),
    wrapInAutoLayoutFrame: vi.fn(() => null),
    booleanOperation: vi.fn(() => null),
    restoreSnapshot: vi.fn(),
    saveHistory: vi.fn(),
    startBatch: vi.fn(),
    endBatch: vi.fn(),
    undo: vi.fn(() => null),
    redo: vi.fn(() => null),
    fitToContent: vi.fn(),
    toggleTool: vi.fn(),
    cancelDrawing: vi.fn(),
    clearSelection: vi.fn(),
    copySelection: vi.fn(),
    cutSelection: vi.fn(),
    copyStyleSelection: vi.fn(),
    pasteStyleSelection: vi.fn(),
    copyAsCss: vi.fn(),
    copyAsSvg: vi.fn(),
  };
}

function seedEmbed(html: string): void {
  useSceneStore.setState({
    nodesById: {
      embed1: {
        id: "embed1",
        type: "embed",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        htmlContent: html,
      } as unknown as FlatSceneNode,
    },
    parentById: { embed1: null },
    childrenById: {},
    rootIds: ["embed1"],
  });
}

function embedHtml(): string {
  return (useSceneStore.getState().nodesById.embed1 as unknown as { htmlContent: string }).htmlContent;
}

/**
 * A picked embed ELEMENT must take priority over the owning embed node on
 * Delete/Backspace — see keyboardCommands.ts's Delete branch doc comment.
 * Getting this backwards deletes the whole screen the moment an element is
 * picked, so this is covered directly rather than trusted to code review.
 */
describe("keyboardCommands — Delete/Backspace with a picked embed element", () => {
  let deps: KeyDownHandlerDeps;
  let handler: (e: KeyboardEvent) => void;

  beforeEach(() => {
    resetStores();
    deps = makeDeps();
    handler = createKeyDownHandler(deps);
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
  });

  it("deletes the picked element, not the embed node", () => {
    const html = "<button>Buy</button><span>Keep</span>";
    seedEmbed(html);
    useSelectionStore.setState({ selectedIds: ["embed1"] });
    useEmbedPickerStore.getState().selectElement(
      {
        embedId: "embed1",
        path: sourcePathToShadowPath("button:nth-of-type(1)", html),
        tagName: "button",
        classes: [],
        textPreview: "Buy",
        outerHtml: "<button>Buy</button>",
      },
      html,
    );

    handler(new KeyboardEvent("keydown", { code: "Delete", key: "Delete" }));

    expect(deps.deleteNode).not.toHaveBeenCalled();
    expect(useEmbedPickerStore.getState().selection).toBeNull();
    expect(useSceneStore.getState().nodesById.embed1).toBeTruthy(); // embed node survives
    expect(embedHtml()).not.toContain("Buy");
    expect(embedHtml()).toContain("Keep");
  });

  it("falls through to deleting the native selection when no element is picked", () => {
    seedEmbed("<button>Buy</button>");
    useSelectionStore.setState({ selectedIds: ["embed1"] });

    handler(new KeyboardEvent("keydown", { code: "Delete", key: "Delete" }));

    expect(deps.deleteNode).toHaveBeenCalledWith("embed1");
  });

  it("falls through when a picker selection exists but the embed is no longer the sole selection", () => {
    const html = "<button>Buy</button>";
    seedEmbed(html);
    useSelectionStore.setState({ selectedIds: ["embed1", "other"] });
    useEmbedPickerStore.getState().selectElement(
      {
        embedId: "embed1",
        path: sourcePathToShadowPath("button:nth-of-type(1)", html),
        tagName: "button",
        classes: [],
        textPreview: "Buy",
        outerHtml: "<button>Buy</button>",
      },
      html,
    );

    handler(new KeyboardEvent("keydown", { code: "Delete", key: "Delete" }));

    expect(deps.deleteNode).toHaveBeenCalledWith("embed1");
    expect(deps.deleteNode).toHaveBeenCalledWith("other");
  });

  // Regression for finding #5 (second round): a rejected element delete
  // (stale path, or one resolving to the source `<body>`, never a legal
  // delete target) must NEVER fall through to deleting the whole embed
  // node — that's exactly the "nukes the entire screen" bug the branch's
  // own comment warns about. (An earlier fix, for finding #4a in the FIRST
  // round, had this falling through instead — that decision is superseded:
  // see keyboardCommands.ts's Delete branch doc comment.) Instead the
  // keystroke is consumed and the stale picker selection is cleared, so a
  // SECOND Delete press — now with no picker selection — removes the embed
  // node normally.
  it("clears the stale picker selection instead of deleting the embed node, on a rejected element delete", () => {
    const html = "<button>Buy</button>";
    seedEmbed(html);
    useSelectionStore.setState({ selectedIds: ["embed1"] });
    useEmbedPickerStore.getState().selectElement(
      {
        embedId: "embed1",
        // Never resolves against `html` — a stale pick.
        path: sourcePathToShadowPath("div:nth-of-type(1) > span:nth-of-type(1)", html),
        tagName: "span",
        classes: [],
        textPreview: "Gone",
        outerHtml: "<span>Gone</span>",
      },
      html,
    );

    handler(new KeyboardEvent("keydown", { code: "Delete", key: "Delete" }));

    expect(deps.deleteNode).not.toHaveBeenCalled();
    expect(useEmbedPickerStore.getState().selection).toBeNull();
    expect(embedHtml()).toBe(html);
    expect(useSceneStore.getState().nodesById.embed1).toBeTruthy();

    // A second Delete press, with no picker selection left, removes the
    // embed node through the normal fallthrough.
    handler(new KeyboardEvent("keydown", { code: "Delete", key: "Delete" }));
    expect(deps.deleteNode).toHaveBeenCalledWith("embed1");
  });

  it("does nothing in read-only (view) mode", () => {
    const html = "<button>Buy</button>";
    seedEmbed(html);
    useSelectionStore.setState({ selectedIds: ["embed1"] });
    useEmbedPickerStore.getState().selectElement(
      {
        embedId: "embed1",
        path: sourcePathToShadowPath("button:nth-of-type(1)", html),
        tagName: "button",
        classes: [],
        textPreview: "Buy",
        outerHtml: "<button>Buy</button>",
      },
      html,
    );
    useEditorModeStore.setState({ mode: "view", presentFrameIds: [], presentIndex: 0 });

    handler(new KeyboardEvent("keydown", { code: "Delete", key: "Delete" }));

    expect(deps.deleteNode).not.toHaveBeenCalled();
    expect(useEmbedPickerStore.getState().selection).not.toBeNull();
    expect(embedHtml()).toBe(html);
  });
});
