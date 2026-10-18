// Chatless tab + running canvas host: every agent entry point delivers a `launch` to the panel.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { resetChatModeForTests } from "@/lib/chatMode";
import { launchEmbedAgentChat } from "@/lib/launchEmbedAgentChat";
import { launchEmbedElementAgentChat } from "@/lib/launchEmbedElementAgentChat";
import { launchFrameAgentChat } from "@/lib/launchFrameAgentChat";
import { launchNodeAgentChat } from "@/lib/launchNodeAgentChat";
import { launchShowcaseAgentChat } from "@/lib/launchShowcaseAgentChat";
import { sendCommentToAgent } from "@/lib/sendCommentToAgent";
import { consumeShowcaseAgentPrompt, storeShowcaseAgentPrompt } from "@/lib/showcaseAgentHandoff";
import { AgentComposerButton } from "@/components/canvas/AgentComposerButton";
import { EmbedLayer } from "@/components/canvas/EmbedLayer";
import { seedEmbedNode } from "@/components/canvas/__tests__/embedLayerFixtures";
import { useChatStore } from "@/store/chatStore";
import { useCommentsStore } from "@/store/commentsStore";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { resetStores } from "@/test/fixtures";
import { canLaunchAgent, deliverAgentLaunch, isCanvasHostRunning } from "../agentLaunch";
import { startCanvasHost } from "../canvasHost";
import type { CanvasHostBridge, CanvasToChatMsg } from "../protocol";

function hostBridge() {
  const posted: CanvasToChatMsg[] = [];
  const bridge: CanvasHostBridge = {
    register: vi.fn(),
    unregister: vi.fn(),
    post: (env) => posted.push(env.msg),
    onMessage: () => () => {},
  };
  const launches = () =>
    posted.filter((m): m is Extract<CanvasToChatMsg, { kind: "launch" }> => m.kind === "launch");
  return { bridge, launches };
}

let stop: (() => void) | undefined;
const startHost = () => {
  const h = hostBridge();
  stop = startCanvasHost(h.bridge);
  return h;
};

beforeEach(() => {
  resetStores();
  window.history.replaceState(null, "", "/app?chat=off");
  resetChatModeForTests();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  stop?.();
  stop = undefined;
  window.history.replaceState(null, "", "/app");
  resetChatModeForTests();
});

const localChats = () => useChatStore.getState().chats.length;

describe("canLaunchAgent", () => {
  it("is false in plain chatless mode, true while the canvas host runs, false after it stops", () => {
    expect(canLaunchAgent()).toBe(false);
    startHost();
    expect(isCanvasHostRunning()).toBe(true);
    expect(canLaunchAgent()).toBe(true);
    stop!();
    stop = undefined;
    expect(canLaunchAgent()).toBe(false);
    expect(deliverAgentLaunch({ text: "x" })).toBe(false);
  });

  it("is true with the chat enabled and no host", () => {
    window.history.replaceState(null, "", "/app");
    resetChatModeForTests();
    expect(canLaunchAgent()).toBe(true);
  });
});

describe("entry points in chatless mode with a canvas host", () => {
  beforeEach(() => {
    useSceneStore.setState({ nodesById: { n1: { id: "n1", type: "frame", name: "Card" } } } as never);
    useCommentsStore.setState({
      threads: [{ id: "t1", order: 3, anchor: { kind: "node", nodeId: "n1", ox: 0, oy: 0 }, messages: [] }],
      draftAnchor: null,
      pinsHidden: false,
    } as never);
  });

  it.each([
    ["launchNodeAgentChat", () => launchNodeAgentChat("n1", "  go  ")],
    ["launchFrameAgentChat", () => launchFrameAgentChat("n1", "go")],
    ["launchEmbedAgentChat", () => launchEmbedAgentChat("n1", "go")],
    [
      "launchEmbedElementAgentChat",
      () => launchEmbedElementAgentChat({ embedId: "n1" } as never, "go"),
    ],
  ])("%s delivers a new-chat launch with the node, selects it and launches nothing locally", async (_n, run) => {
    const h = startHost();
    const before = localChats();
    expect(await run()).toBe(true);
    expect(h.launches()).toHaveLength(1);
    expect(h.launches()[0].launchId).toEqual(expect.any(String));
    expect(h.launches()[0].payload).toEqual({ text: "go", nodeIds: ["n1"], target: "new-chat" });
    expect(useSelectionStore.getState().selectedIds).toEqual(["n1"]);
    expect(localChats()).toBe(before);
    expect(useChatStore.getState().launchQueue).toEqual({});
  });

  it("sendCommentToAgent delivers the comment prompt with the anchor node", () => {
    const h = startHost();
    expect(sendCommentToAgent("t1")).toBe(true);
    expect(h.launches()[0].payload).toEqual({
      text: "разберись с комментарием #3",
      nodeIds: ["n1"],
      target: "new-chat",
    });
    expect(useChatStore.getState().launchQueue).toEqual({});
  });

  it("the composer button and the empty-embed composer are shown only while the host runs", () => {
    const button = () => render(<AgentComposerButton anchor={{ x: 0, y: 0 }} placeholder="p" onSend={() => {}} />);
    expect(button().container.querySelector("[data-agent-composer]")).toBeNull();
    cleanup();

    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
    seedEmbedNode("");
    useSceneStore.setState((s) => ({ nodesById: { ...s.nodesById, e1: { ...s.nodesById.e1, width: 400, height: 300 } } }));
    expect(render(<EmbedLayer />).container.querySelector("textarea")).toBeNull();
    cleanup();

    startHost();
    expect(button().container.querySelector("[data-agent-composer]")).not.toBeNull();
    cleanup();
    expect(render(<EmbedLayer />).container.querySelector("textarea")).not.toBeNull();
  });

  it("the showcase prompt stays in sessionStorage without a host, is forwarded once when the host runs, then removed", () => {
    storeShowcaseAgentPrompt("make a travel app");
    expect(launchShowcaseAgentChat()).toBe(false);
    const h = startHost();
    expect(launchShowcaseAgentChat()).toBe(true);
    expect(launchShowcaseAgentChat()).toBe(false);
    expect(h.launches()).toHaveLength(1);
    expect(h.launches()[0].payload).toEqual({ text: "make a travel app", target: "new-chat" });
    expect(consumeShowcaseAgentPrompt()).toBeNull();
    expect(useChatStore.getState().launchQueue).toEqual({});
  });
});

describe("entry points in chatless mode without a host", () => {
  it("stay inert and leave the showcase prompt in sessionStorage", async () => {
    storeShowcaseAgentPrompt("keep me");
    expect(await launchNodeAgentChat("n1", "go")).toBe(false);
    expect(sendCommentToAgent("t1")).toBe(false);
    expect(launchShowcaseAgentChat()).toBe(false);
    expect(consumeShowcaseAgentPrompt()).toBe("keep me");
  });
});
