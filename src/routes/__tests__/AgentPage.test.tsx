import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";

// The /agent page must never pull the canvas stack in. If anything on its
// import graph reaches PixiCanvas, importing it throws and the suite fails.
vi.mock("@/pixi/PixiCanvas", () => {
  throw new Error("PixiCanvas must not be imported by /agent");
});
// The chat's tool registry legitimately reaches some src/pixi modules, so the
// invariant is "no pixi.js Application is ever constructed", not "no import".
const applicationCtor = vi.hoisted(() => vi.fn());
vi.mock("pixi.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("pixi.js")>();
  class Application {
    constructor() {
      applicationCtor();
      throw new Error("pixi.js Application must not be constructed by /agent");
    }
  }
  return { ...actual, Application };
});

import AgentPage from "../AgentPage";
import { useChatStore } from "@/store/chatStore";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";
import { resetStores } from "@/test/fixtures";

function renderAgent() {
  return render(
    <MemoryRouter initialEntries={["/agent"]}>
      <Routes>
        <Route path="/agent" element={<AgentPage />} />
        <Route path="/app" element={<div>editor route</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const sseBody = [
  { type: "start" },
  { type: "start-step" },
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: "hello from the agent" },
  { type: "text-end", id: "t1" },
  { type: "finish-step" },
  { type: "finish" },
]
  .map((c) => `data: ${JSON.stringify(c)}\n\n`)
  .join("") + "data: [DONE]\n\n";

// Every request is stubbed (models, skills, auth, chat): no real network.
const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
  String(input).includes("/api/chat")
    ? new Response(sseBody, {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-vercel-ai-ui-message-stream": "v1",
        },
      })
    : new Response("{}", { status: 404 }),
);

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  localStorage.clear();
  resetStores();
  useChatStore.setState({ chats: [], activeChatId: null, sessionActions: {} });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete window.penAgentPanel;
});

describe("<AgentPage />", () => {
  it("renders only the chat panel: no canvas, no rail, no expand toggle", async () => {
    renderAgent();
    expect(screen.getByTestId("chat-list")).toBeTruthy();
    expect(document.querySelector("canvas")).toBeNull();
    expect(screen.queryByLabelText("Expand panel")).toBeNull();
    expect(screen.queryByLabelText("Collapse panel")).toBeNull();
    expect(applicationCtor).not.toHaveBeenCalled();
  });

  it("has no Design Agent title row and puts the skills button next to New chat", async () => {
    renderAgent();
    expect(screen.queryByText("Design Agent")).toBeNull();
    // chat list: skills button sits beside the "New chat" button
    const newChat = screen.getByTestId("chat-list-new");
    const skills = screen.getByRole("button", { name: "Manage skills" });
    expect(newChat.nextElementSibling).toBe(skills);
    // open chat: skills button sits right after the "+" button in the chat header
    act(() => {
      useChatStore.getState().createChat();
    });
    const plus = await screen.findByTestId("create-chat-button");
    const skillsInChat = screen.getByRole("button", { name: "Manage skills" });
    expect(plus.nextElementSibling).toBe(skillsInChat);
    expect(screen.getAllByRole("button", { name: "Manage skills" })).toHaveLength(1);
    fireEvent.click(skillsInChat);
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("paints the page with the panel surface", () => {
    const { unmount } = renderAgent();
    expect(document.documentElement.classList.contains("route-agent")).toBe(true);
    unmount();
    expect(document.documentElement.classList.contains("route-agent")).toBe(false);
  });

  it("does not touch the global left sidebar store", async () => {
    localStorage.setItem("left-sidebar-section", "pages");
    useLeftSidebarStore.setState({ activeSection: "pages", isPanelOpen: false });
    renderAgent();
    expect(screen.getByTestId("chat-list")).toBeTruthy();
    expect(useLeftSidebarStore.getState().activeSection).toBe("pages");
    expect(useLeftSidebarStore.getState().isPanelOpen).toBe(false);
    expect(localStorage.getItem("left-sidebar-section")).toBe("pages");
  });

  it("renders in the desktop agent panel even in a production build", () => {
    vi.stubEnv("DEV", false);
    window.penAgentPanel = { version: 1 };
    renderAgent();
    expect(screen.getByTestId("chat-list")).toBeTruthy();
  });

  it("redirects to /app on the public web (production, no agent panel)", () => {
    vi.stubEnv("DEV", false);
    renderAgent();
    expect(screen.getByText("editor route")).toBeTruthy();
    expect(screen.queryByTestId("chat-list")).toBeNull();
  });

  it("sends a message through the stubbed /api/chat stream", async () => {
    renderAgent();
    act(() => {
      useChatStore.getState().createChat();
    });
    const box = await screen.findByRole("textbox");
    fireEvent.change(box, { target: { value: "design a login screen" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByText("hello from the agent")).toBeTruthy());
    const chatCall = fetchMock.mock.calls.find(([u]) => String(u).includes("/api/chat"));
    expect(chatCall).toBeTruthy();
  });
});
