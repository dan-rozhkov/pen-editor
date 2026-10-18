import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { chatHiddenSections, isChatDisabled, resetChatModeForTests } from "@/lib/chatMode";
import { getCommands } from "@/lib/commands/registry";
import { launchNodeAgentChat } from "@/lib/launchNodeAgentChat";
import { sendCommentToAgent } from "@/lib/sendCommentToAgent";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";
import { useSceneStore } from "@/store/sceneStore";
import { useChatStore } from "@/store/chatStore";
import { useEditorModeStore } from "@/store/editorModeStore";
import { LeftRail } from "@/components/LeftRail";
import { AgentComposerButton } from "@/components/canvas/AgentComposerButton";
import { EmbedLayer } from "@/components/canvas/EmbedLayer";
import { resetStores } from "@/test/fixtures";
import { seedEmbedNode } from "@/components/canvas/__tests__/embedLayerFixtures";

function setSearch(search: string) {
  window.history.replaceState(null, "", `/app${search}`);
  resetChatModeForTests();
}

beforeEach(() => resetStores());
afterEach(() => {
  cleanup();
  setSearch("");
});

describe("isChatDisabled", () => {
  it.each([
    ["", false],
    ["?chat=on", false],
    ["?chat", false],
    ["?chat=off", true],
    ["?chat=OFF", true],
    ["?chat=0", true],
    ["?chat=false", true],
  ])("%s -> %s", (search, expected) => {
    setSearch(search);
    expect(isChatDisabled()).toBe(expected);
  });

  it("is true when the desktop preload exposes agentLayout, even without the URL flag", () => {
    setSearch("");
    window.penDesktop = { agentLayout: true, onMenuCommand: () => () => {} };
    try {
      expect(isChatDisabled()).toBe(true);
    } finally {
      delete window.penDesktop;
    }
    setSearch("");
    window.penDesktop = { agentLayout: false, onMenuCommand: () => () => {} };
    try {
      expect(isChatDisabled()).toBe(false);
    } finally {
      delete window.penDesktop;
    }
  });

  it("is sticky once seen ON: an SPA navigate that drops the query keeps it on", () => {
    setSearch("?chat=off");
    expect(isChatDisabled()).toBe(true);
    window.history.replaceState(null, "", "/app");
    expect(isChatDisabled()).toBe(true);
  });

  it("is not frozen while OFF: an early read without the flag, then the flagged URL, is true", () => {
    setSearch("");
    expect(isChatDisabled()).toBe(false);
    window.history.replaceState(null, "", "/app?chat=off");
    expect(isChatDisabled()).toBe(true);
  });
});

describe("chatless mode", () => {
  beforeEach(() => setSearch("?chat=off"));

  it("hides the Agents rail item but keeps the others", () => {
    render(<LeftRail hiddenSections={chatHiddenSections()} />);
    expect(screen.queryByTestId("rail-agents")).toBeNull();
    expect(screen.getByTestId("rail-pages")).toBeTruthy();
  });

  it("never leaves leftSidebarStore on agents, and does not persist the rejected choice", () => {
    useLeftSidebarStore.getState().setActiveSection("slides");
    useLeftSidebarStore.getState().setActiveSection("agents");
    expect(useLeftSidebarStore.getState().activeSection).toBe("pages");
    expect(localStorage.getItem("left-sidebar-section")).toBe("slides");
  });

  it("drops the chat-only palette command", () => {
    expect(getCommands().some((c) => c.id === "file-connect-opencode")).toBe(false);
  });

  it("agent launch helpers are inert", async () => {
    const before = useChatStore.getState().chats.length;
    expect(await launchNodeAgentChat("n1", "hi")).toBe(false);
    expect(await sendCommentToAgent("t1")).toBe(false);
    expect(useChatStore.getState().chats.length).toBe(before);
  });

  it("an empty embed keeps its dashed empty-state outline but has no agent prompt input", () => {
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
    seedEmbedNode("");
    const { container } = render(<EmbedLayer />);
    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]');
    expect(host).not.toBeNull();
    expect(host!.hasAttribute("data-embed-prompt")).toBe(true);
    expect(host!.hasAttribute("data-embed-outline")).toBe(true);
    expect(container.querySelector("[data-agent-composer]")).toBeNull();
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("the shared AgentComposerButton renders nothing", () => {
    const { container } = render(<AgentComposerButton anchor={{ x: 0, y: 0 }} placeholder="p" onSend={() => {}} />);
    expect(container.querySelector("[data-agent-composer]")).toBeNull();
  });
});

describe("chat enabled (no flag)", () => {
  it("renders the shared AgentComposerButton", () => {
    setSearch("");
    const { container } = render(<AgentComposerButton anchor={{ x: 0, y: 0 }} placeholder="p" onSend={() => {}} />);
    expect(container.querySelector("[data-agent-composer]")).not.toBeNull();
  });

  it("an empty embed shows the agent prompt input", () => {
    setSearch("");
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
    seedEmbedNode("");
    // The composer needs a node at least 180x72 (see MIN_COMPOSER_*).
    useSceneStore.setState((s) => ({ nodesById: { ...s.nodesById, e1: { ...s.nodesById.e1, width: 400, height: 300 } } }));
    const { container } = render(<EmbedLayer />);
    expect(container.querySelector("textarea")).not.toBeNull();
  });

  it("keeps the Agents section, the palette command and the launch helpers", async () => {
    setSearch("");
    expect(chatHiddenSections()).toBeUndefined();
    render(<LeftRail hiddenSections={chatHiddenSections()} />);
    expect(screen.getByTestId("rail-agents")).toBeTruthy();
    useLeftSidebarStore.getState().setActiveSection("agents");
    expect(useLeftSidebarStore.getState().activeSection).toBe("agents");
    expect(getCommands().some((c) => c.id === "file-connect-opencode")).toBe(true);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await launchNodeAgentChat("n1", "hi")).toBe(true);
  });
});
