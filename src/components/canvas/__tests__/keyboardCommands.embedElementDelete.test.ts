import { beforeEach, describe, expect, it } from "vitest";
import type { KeyDownHandlerDeps } from "../keyboardCommands";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { sourcePathToShadowPath } from "@/lib/embedLayerTree";
import { resetStores } from "@/test/fixtures";
import {
  elementSelection,
  embedHtmlOf,
  key,
  seedEmbedNode,
  setupKeyDownHandler,
} from "./keyboardCommandFixtures";

const embedHtml = () => embedHtmlOf("embed1");

/** Picks `<tag>text</tag>` at `sourcePath` in embed1's `html`, the way the layers panel does. */
function pick(html: string, sourcePath: string, tagName: string, textPreview: string): void {
  useEmbedPickerStore.getState().selectElement(
    elementSelection({
      embedId: "embed1",
      path: sourcePathToShadowPath(sourcePath, html),
      tagName,
      textPreview,
      outerHtml: `<${tagName}>${textPreview}</${tagName}>`,
    }),
    html,
  );
}

/** embed1 holding `html`, as the sole selection, with its first `<button>Buy</button>` picked. */
function seedPickedButton(html: string): void {
  seedEmbedNode("embed1", html);
  useSelectionStore.setState({ selectedIds: ["embed1"] });
  pick(html, "button:nth-of-type(1)", "button", "Buy");
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
    ({ deps, handler } = setupKeyDownHandler());
  });

  it("deletes the picked element, not the embed node", () => {
    const html = "<button>Buy</button><span>Keep</span>";
    seedPickedButton(html);

    handler(key("Delete"));

    expect(deps.deleteNode).not.toHaveBeenCalled();
    expect(useEmbedPickerStore.getState().selection).toBeNull();
    expect(useSceneStore.getState().nodesById.embed1).toBeTruthy(); // embed node survives
    expect(embedHtml()).not.toContain("Buy");
    expect(embedHtml()).toContain("Keep");
  });

  it("falls through to deleting the native selection when no element is picked", () => {
    seedEmbedNode("embed1", "<button>Buy</button>");
    useSelectionStore.setState({ selectedIds: ["embed1"] });

    handler(key("Delete"));

    expect(deps.deleteNode).toHaveBeenCalledWith("embed1");
  });

  it("falls through when a picker selection exists but the embed is no longer the sole selection", () => {
    const html = "<button>Buy</button>";
    seedEmbedNode("embed1", html);
    useSelectionStore.setState({ selectedIds: ["embed1", "other"] });
    pick(html, "button:nth-of-type(1)", "button", "Buy");

    handler(key("Delete"));

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
    seedEmbedNode("embed1", html);
    useSelectionStore.setState({ selectedIds: ["embed1"] });
    // Never resolves against `html` — a stale pick.
    pick(html, "div:nth-of-type(1) > span:nth-of-type(1)", "span", "Gone");

    handler(key("Delete"));

    expect(deps.deleteNode).not.toHaveBeenCalled();
    expect(useEmbedPickerStore.getState().selection).toBeNull();
    expect(embedHtml()).toBe(html);
    expect(useSceneStore.getState().nodesById.embed1).toBeTruthy();

    // A second Delete press, with no picker selection left, removes the
    // embed node through the normal fallthrough.
    handler(key("Delete"));
    expect(deps.deleteNode).toHaveBeenCalledWith("embed1");
  });

  it("does nothing in read-only (view) mode", () => {
    const html = "<button>Buy</button>";
    seedPickedButton(html);
    useEditorModeStore.setState({ mode: "view", presentFrameIds: [], presentIndex: 0 });

    handler(key("Delete"));

    expect(deps.deleteNode).not.toHaveBeenCalled();
    expect(useEmbedPickerStore.getState().selection).not.toBeNull();
    expect(embedHtml()).toBe(html);
  });
});
