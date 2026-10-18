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
import { toast } from "sonner";
import {
  LAUNCH_ACK_TIMEOUT_MS,
  LAUNCH_NO_ACK_MESSAGE,
  canLaunchAgent,
  deliverAgentLaunch,
  isCanvasHostRunning,
} from "../agentLaunch";
import { startCanvasHost } from "../canvasHost";
import type { CanvasHostBridge, CanvasToChatMsg, ChatToCanvasMsg } from "../protocol";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

/** `ack`: how the fake panel answers a launch (true = clean ack, string = error ack, false = silence). */
function hostBridge(ack: boolean | string = true) {
  const posted: CanvasToChatMsg[] = [];
  let listener: ((env: { id: string; sentAt: number; msg: ChatToCanvasMsg }) => void) | undefined;
  const bridge: CanvasHostBridge = {
    register: vi.fn(),
    unregister: vi.fn(),
    post: (env) => {
      posted.push(env.msg);
      if (env.msg.kind === "launch" && ack !== false) {
        const launchId = env.msg.launchId;
        queueMicrotask(() =>
          listener?.({
            id: "ack",
            sentAt: 0,
            msg: { kind: "launch-ack", launchId, ...(typeof ack === "string" ? { error: ack } : {}) },
          })
        );
      }
    },
    onMessage: (cb) => {
      listener = cb as typeof listener;
      return () => {};
    },
  };
  const launches = () =>
    posted.filter((m): m is Extract<CanvasToChatMsg, { kind: "launch" }> => m.kind === "launch");
  return { bridge, launches };
}

let stop: (() => void) | undefined;
const startHost = (ack: boolean | string = true) => {
  const h = hostBridge(ack);
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
  it("is false in plain chatless mode, true while the canvas host runs, false after it stops", async () => {
    expect(canLaunchAgent()).toBe(false);
    startHost();
    expect(isCanvasHostRunning()).toBe(true);
    expect(canLaunchAgent()).toBe(true);
    stop!();
    stop = undefined;
    expect(canLaunchAgent()).toBe(false);
    await expect(deliverAgentLaunch({ text: "x" })).resolves.toBe(false);
  });

  it("is false when register() throws (no host that can deliver)", () => {
    const h = hostBridge();
    (h.bridge.register as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("no ipc");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stop = startCanvasHost(h.bridge);
    expect(isCanvasHostRunning()).toBe(false);
    expect(canLaunchAgent()).toBe(false);
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
  ])("%s delivers a new-chat launch without selecting the node and launches nothing locally", async (_n, run) => {
    const h = startHost();
    const before = localChats();
    expect(await run()).toBe(true);
    expect(h.launches()).toHaveLength(1);
    expect(h.launches()[0].launchId).toEqual(expect.any(String));
    expect(h.launches()[0].payload).toEqual({ text: "go", target: "new-chat" });
    expect(useSelectionStore.getState().selectedIds).toEqual([]);
    expect(localChats()).toBe(before);
    expect(useChatStore.getState().launchQueue).toEqual({});
  });

  it("sendCommentToAgent delivers the comment prompt like the local one (no node ids)", async () => {
    const h = startHost();
    expect(await sendCommentToAgent("t1")).toBe(true);
    expect(h.launches()[0].payload).toEqual({
      text: "разберись с комментарием #3",
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

  it("the showcase prompt stays in sessionStorage without a host, is forwarded once when the host runs, then removed on the ack", async () => {
    storeShowcaseAgentPrompt("make a travel app");
    expect(await launchShowcaseAgentChat()).toBe(false);
    const h = startHost();
    expect(await launchShowcaseAgentChat()).toBe(true);
    expect(await launchShowcaseAgentChat()).toBe(false);
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
    expect(await sendCommentToAgent("t1")).toBe(false);
    expect(await launchShowcaseAgentChat()).toBe(false);
    expect(consumeShowcaseAgentPrompt()).toBe("keep me");
  });
});

describe("launch acknowledgement", () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
    useSceneStore.setState({ nodesById: { n1: { id: "n1", type: "frame", name: "Card" } } } as never);
  });

  it("resolves true on the ack, without a toast", async () => {
    startHost(true);
    await expect(deliverAgentLaunch({ text: "x" })).resolves.toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("returns false and toasts when the panel does not answer within the timeout", async () => {
    vi.useFakeTimers();
    try {
      startHost(false);
      const p = deliverAgentLaunch({ text: "x" });
      await vi.advanceTimersByTimeAsync(LAUNCH_ACK_TIMEOUT_MS - 1);
      expect(toast.error).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2);
      await expect(p).resolves.toBe(false);
      expect(toast.error).toHaveBeenCalledWith(LAUNCH_NO_ACK_MESSAGE);
      expect(LAUNCH_NO_ACK_MESSAGE).toBe("The agent panel did not respond.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("an error ack returns false and toasts its message; entry points report the failure", async () => {
    startHost("The agent panel could not reach this canvas tab.");
    expect(await launchNodeAgentChat("n1", "go")).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("The agent panel could not reach this canvas tab.");
  });

  it("keeps the showcase prompt without an ack (and shows no toast), removes it with one", async () => {
    vi.useFakeTimers();
    try {
      startHost(false);
      storeShowcaseAgentPrompt("keep until ack");
      const p = launchShowcaseAgentChat();
      await vi.advanceTimersByTimeAsync(LAUNCH_ACK_TIMEOUT_MS + 1);
      expect(await p).toBe(false);
      expect(toast.error).not.toHaveBeenCalled();
      expect(sessionStorage.getItem("pen:showcase-agent-prompt:v1")).toBe("keep until ack");
    } finally {
      vi.useRealTimers();
    }
    stop?.();
    startHost(true);
    expect(await launchShowcaseAgentChat()).toBe(true);
    expect(sessionStorage.getItem("pen:showcase-agent-prompt:v1")).toBeNull();
  });

  it("does not send the same showcase prompt twice while the first launch waits for its ack", async () => {
    vi.useFakeTimers();
    try {
      const h = startHost(false);
      storeShowcaseAgentPrompt("once");
      const first = launchShowcaseAgentChat();
      expect(await launchShowcaseAgentChat()).toBe(false);
      await vi.advanceTimersByTimeAsync(LAUNCH_ACK_TIMEOUT_MS + 1);
      await first;
      expect(h.launches()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
