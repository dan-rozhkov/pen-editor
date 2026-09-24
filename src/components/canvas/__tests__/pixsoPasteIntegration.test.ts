import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetStores } from "@/test/fixtures";
import { useSceneStore } from "@/store/sceneStore";
import { useClipboardStore } from "@/store/clipboardStore";
import rectHtml from "@/lib/pixsoPaste/__tests__/fixtures/rect.html?raw";
import textHtml from "@/lib/pixsoPaste/__tests__/fixtures/text.html?raw";
import type { RectNode, TextNode } from "@/types/scene";
import { fakeClipboardEvent, makePasteActions } from "./pasteIntegrationFixtures";

vi.mock("sonner", () => ({ toast: vi.fn() }));

describe("handlePaste — Pixso clipboard payload", () => {
  beforeEach(() => {
    resetStores();
    useClipboardStore.setState({ copiedNodes: [], lastCopiedAt: 0 });
  });

  it("converts a Pixso rect clipboard payload into a red 200x100 rect node", async () => {
    const { handlePaste } = makePasteActions();

    await handlePaste(fakeClipboardEvent(rectHtml));

    const state = useSceneStore.getState();
    expect(state.rootIds).toHaveLength(1);
    const node = state.nodesById[state.rootIds[0]] as RectNode;
    expect(node.type).toBe("rect");
    expect(Math.round(node.width)).toBe(200);
    expect(Math.round(node.height)).toBe(100);
    expect(node.fill).toBe("#ff0000");
  });

  it("converts a Pixso text clipboard payload into a text node with the characters", async () => {
    const { handlePaste } = makePasteActions();

    await handlePaste(fakeClipboardEvent(textHtml));

    const state = useSceneStore.getState();
    expect(state.rootIds).toHaveLength(1);
    const node = state.nodesById[state.rootIds[0]] as TextNode;
    expect(node.type).toBe("text");
    expect(node.text.startsWith("Карточка товара")).toBe(true);
  });
});
