import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const { trackMock } = vi.hoisted(() => ({ trackMock: vi.fn() }));
vi.mock("@/lib/analytics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analytics")>();
  return { ...actual, track: trackMock };
});

// Overrides canSendImages() for selectionHint gating tests below; every
// other test falls through to the real (fallback-model-backed) behavior, so
// this must not disturb the loadModels()/GET-api-models tests elsewhere in
// this file.
const chatModelsOverride = vi.hoisted(
  () => ({ canSendImages: undefined as boolean | undefined }),
);
vi.mock("@/lib/chatModels", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chatModels")>();
  return {
    ...actual,
    canSendImages: (model: string) =>
      chatModelsOverride.canSendImages ?? actual.canSendImages(model),
  };
});

// Captures every `DefaultChatTransport` construction so the "merges the
// transport's base headers" test (defect 4) can grab the real
// `prepareSendMessagesRequest` useDesignChat.ts builds and call it directly.
// A plain `vi.spyOn` on the "ai" module's export doesn't work here — its
// namespace object isn't configurable in Vitest's ESM handling (see the
// TypeError it throws: "Cannot spy on export... Module namespace is not
// configurable in ESM") — so this wraps the real class in `vi.mock` instead,
// which every other test in this file also relies on behaving identically to
// the unmocked export.
const { capturedTransportOptions } = vi.hoisted(() => ({
  capturedTransportOptions: [] as unknown[],
}));
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  class SpyingDefaultChatTransport<
    UI_MESSAGE extends import("ai").UIMessage,
  > extends actual.DefaultChatTransport<UI_MESSAGE> {
    constructor(
      options: ConstructorParameters<typeof actual.DefaultChatTransport<UI_MESSAGE>>[0],
    ) {
      capturedTransportOptions.push(options);
      super(options);
    }
  }
  return { ...actual, DefaultChatTransport: SpyingDefaultChatTransport };
});

import {
  executeToolCall,
  buildCanvasContext,
  resolveChatApiUrl,
  useDesignChat,
} from "@/hooks/useDesignChat";
import { toolHandlers, type ToolHandler } from "@/lib/toolRegistry";
import { clearOpenCodeKey, setOpenCodeKey } from "@/lib/opencodeKey";
import { useSelectionStore } from "@/store/selectionStore";
import { useChatStore } from "@/store/chatStore";
import { useSceneStore } from "@/store/sceneStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { useRepoContextStore } from "@/store/repoContextStore";
import { useHistoryStore } from "@/store/historyStore";
import { useAiVectorPreviewStore, vectorPreviewKey } from "@/store/aiVectorPreviewStore";
import { resetStores, seedScene, seedVariables } from "@/test/fixtures";

const TEST_TOOL = "__test_tool__";

// `generate_image` (unlike TEST_TOOL) is a real registry entry, so a test
// that stubs it must restore the original handler afterward — otherwise it
// permanently removes image generation for every test that runs later in
// this file. Saved here and restored unconditionally in the top-level
// afterEach below, so a failed assertion mid-test still can't leave the
// hanging stub installed.
let savedGenerateImageHandler: ToolHandler | undefined;

function clearChatApiEnv() {
  vi.stubEnv("VITE_AI_API_URL", undefined);
  vi.stubEnv("VITE_DESIGN_AGENT_BACKEND_URL", undefined);
}

afterEach(() => {
  delete toolHandlers[TEST_TOOL];
  if (savedGenerateImageHandler) {
    toolHandlers.generate_image = savedGenerateImageHandler;
    savedGenerateImageHandler = undefined;
  }
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  trackMock.mockClear();
  chatModelsOverride.canSendImages = undefined;
});

// Regression: images must survive to the request body unchanged — the
// backend now decides native-vs-described per model
// (pen-editor-backend/src/ai/vision-messages.ts), so the frontend must never
// strip or rewrite image parts before sending.
describe("image parts in the outgoing request", () => {
  it("sends messages with file/image parts unmodified", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      const body =
        [{ type: "start" }, { type: "start-step" }, { type: "finish-step" }, { type: "finish" }]
          .map((c) => `data: ${JSON.stringify(c)}\n\n`)
          .join("") + "data: [DONE]\n\n";
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-vercel-ai-ui-message-stream": "v1",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sessionId = `image-session-${Date.now()}`;
    const { result } = renderHook(() => useDesignChat({ sessionId }));

    await act(async () => {
      result.current.submitLaunchPayload({
        text: "look at this",
        images: [{ dataUrl: "data:image/png;base64,AAAA", name: "shot.png" }],
      });
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const sentMessages = requests[0].messages as Array<{
      role: string;
      parts: Array<Record<string, unknown>>;
    }>;
    const userMessage = sentMessages.find((m) => m.role === "user");
    expect(userMessage).toBeDefined();
    const filePart = userMessage!.parts.find((p) => p.type === "file");
    expect(filePart).toEqual({
      type: "file",
      mediaType: "image/png",
      url: "data:image/png;base64,AAAA",
    });
  });
});

describe("executeToolCall", () => {
  it("returns a JSON error for an unknown tool", async () => {
    const result = await executeToolCall("definitely_not_a_tool", {});
    expect(JSON.parse(result)).toEqual({
      error: "Unknown tool: definitely_not_a_tool",
    });
  });

  it("returns a JSON error when the handler throws", async () => {
    toolHandlers[TEST_TOOL] = async () => {
      throw new Error("boom");
    };
    const result = await executeToolCall(TEST_TOOL, {});
    expect(JSON.parse(result)).toEqual({ error: "boom" });
  });

  it("passes {} to the handler for null or non-object input", async () => {
    const seen: unknown[] = [];
    toolHandlers[TEST_TOOL] = async (args) => {
      seen.push(args);
      return "ok";
    };

    await executeToolCall(TEST_TOOL, null);
    await executeToolCall(TEST_TOOL, "a string");
    await executeToolCall(TEST_TOOL, 42);
    expect(seen).toEqual([{}, {}, {}]);
  });

  it("passes object input through to the handler and returns its result", async () => {
    toolHandlers[TEST_TOOL] = async (args) => JSON.stringify(args);
    const result = await executeToolCall(TEST_TOOL, { a: 1 });
    expect(JSON.parse(result)).toEqual({ a: 1 });
  });

  it("times out after 30 seconds", async () => {
    vi.useFakeTimers();
    toolHandlers[TEST_TOOL] = () => new Promise<string>(() => {});

    const pending = executeToolCall(TEST_TOOL, {});
    await vi.advanceTimersByTimeAsync(30_001);
    const result = await pending;
    expect(JSON.parse(result)).toEqual({ error: "Tool call timed out" });
  });

  it("does not time out image-generation tools at the default 30s budget", async () => {
    vi.useFakeTimers();
    savedGenerateImageHandler = toolHandlers.generate_image;
    toolHandlers.generate_image = () => new Promise<string>(() => {});

    const pending = executeToolCall("generate_image", {});
    await vi.advanceTimersByTimeAsync(30_001);
    // Still pending: generate_image gets the longer 95s budget, not the
    // 30s default, so it must not have resolved/rejected yet.
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(95_001 - 30_001);
    const result = await pending;
    expect(JSON.parse(result)).toEqual({ error: "Tool call timed out" });
  });

  it("emits agent_tool_executed with ok:false and error_kind:'timeout' on timeout", async () => {
    vi.useFakeTimers();
    toolHandlers[TEST_TOOL] = () => new Promise<string>(() => {});

    const pending = executeToolCall(TEST_TOOL, {}, undefined, "chat");
    await vi.advanceTimersByTimeAsync(30_001);
    await pending;

    expect(trackMock).toHaveBeenCalledWith(
      "agent_tool_executed",
      expect.objectContaining({
        tool_name: TEST_TOOL,
        ok: false,
        error_kind: "timeout",
        source: "chat",
      }),
    );
  });

  it("emits agent_tool_executed with ok:true on success", async () => {
    toolHandlers[TEST_TOOL] = async () => "ok";
    await executeToolCall(TEST_TOOL, {}, undefined, "chat");

    expect(trackMock).toHaveBeenCalledWith(
      "agent_tool_executed",
      expect.objectContaining({
        tool_name: TEST_TOOL,
        ok: true,
        source: "chat",
      }),
    );
  });

  it("emits ok:false when a handler returns the executeToolCall error shape (no JSON.parse needed)", async () => {
    toolHandlers[TEST_TOOL] = async () => JSON.stringify({ error: "nodeId is required" });
    await executeToolCall(TEST_TOOL, {}, undefined, "chat");

    expect(trackMock).toHaveBeenCalledWith(
      "agent_tool_executed",
      expect.objectContaining({
        tool_name: TEST_TOOL,
        ok: false,
        error_kind: "handler_error",
        source: "chat",
      }),
    );
  });

  it("emits ok:true for a large JSON success payload without JSON.parse-ing it (get_screenshot shape)", async () => {
    const hugeImageData = `data:image/png;base64,${"A".repeat(50_000)}`;
    toolHandlers[TEST_TOOL] = async () => JSON.stringify({ imageData: hugeImageData });
    await executeToolCall(TEST_TOOL, {}, undefined, "chat");

    expect(trackMock).toHaveBeenCalledWith(
      "agent_tool_executed",
      expect.objectContaining({ tool_name: TEST_TOOL, ok: true, source: "chat" }),
    );
  });

  it("defaults source to 'bridge' when the caller doesn't pass one", async () => {
    toolHandlers[TEST_TOOL] = async () => "ok";
    await executeToolCall(TEST_TOOL, {});

    expect(trackMock).toHaveBeenCalledWith(
      "agent_tool_executed",
      expect.objectContaining({ source: "bridge" }),
    );
  });
});

describe("buildCanvasContext", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
    seedVariables();
  });

  it("serializes scene roots, selection and variables, with no agentMode", () => {
    useSelectionStore.setState({ selectedIds: ["rect1"] });

    const context = buildCanvasContext() as Record<string, unknown>;

    expect(context).not.toHaveProperty("agentMode");
    // The user's pick travels with the turn; with no chat id it falls back
    // to the store's active-chat model.
    expect(context.model).toBe(useChatStore.getState().model);

    const canvas = JSON.parse(context.canvasContext as string);
    expect(canvas.roots).toEqual([
      { id: "frame1", type: "frame", name: "Screen" },
      { id: "rect2", type: "rect", name: "Floating" },
    ]);
    expect(canvas.selectedIds).toEqual(["rect1"]);
    expect(canvas.selectedNodes).toEqual([
      { id: "rect1", type: "rect", name: "Box", x: 10, y: 20, width: 100, height: 50 },
    ]);
    expect(canvas.activeTheme).toBe("light");
    expect(canvas.variables).toEqual([
      {
        name: "--primary",
        type: "color",
        value: "#3366ff",
        themeValues: { light: "#3366ff", dark: "#99bbff" },
        cssName: "--primary",
      },
      { name: "--radius-m", type: "number", value: "8", cssName: "--radius-m" },
    ]);
  });

  it("falls back to bare ids for unknown selected nodes", () => {
    useSelectionStore.setState({ selectedIds: ["ghost"] });
    const context = buildCanvasContext() as { canvasContext: string };
    const canvas = JSON.parse(context.canvasContext);
    expect(canvas.selectedNodes).toEqual([{ id: "ghost" }]);
  });

  it("adds selectionHint when a frame is selected and the model can be sent images — its screenshot is never auto-attached", () => {
    chatModelsOverride.canSendImages = true;
    useSelectionStore.setState({ selectedIds: ["frame1"] });
    const context = buildCanvasContext() as { canvasContext: string };
    const canvas = JSON.parse(context.canvasContext);
    expect(canvas.selectionHint).toBe(
      "Screenshots of the selected nodes are intentionally NOT attached. If you need to see one, call get_screenshot with its node id."
    );
  });

  // The hint is universal now — no node type is auto-screenshotted, so any
  // non-empty selection (not just a frame) triggers it.
  it("adds selectionHint for a non-frame selection too", () => {
    chatModelsOverride.canSendImages = true;
    useSelectionStore.setState({ selectedIds: ["rect1"] });
    const context = buildCanvasContext() as { canvasContext: string };
    const canvas = JSON.parse(context.canvasContext);
    expect(canvas.selectionHint).toBe(
      "Screenshots of the selected nodes are intentionally NOT attached. If you need to see one, call get_screenshot with its node id."
    );
  });

  // Regression: get_screenshot is dropped from the model's toolset entirely
  // when the model has no native vision AND no VISION_MODEL is configured
  // (pen-editor-backend's per-request tool set — see the root CLAUDE.md's
  // "Agent vision" section). canSendImages() mirrors that exact condition on
  // the frontend; pointing the model at a tool it doesn't have would waste a
  // turn.
  it("omits selectionHint for a selection when the model can't be sent images", () => {
    chatModelsOverride.canSendImages = false;
    useSelectionStore.setState({ selectedIds: ["frame1"] });
    const context = buildCanvasContext() as { canvasContext: string };
    const canvas = JSON.parse(context.canvasContext);
    expect(canvas).not.toHaveProperty("selectionHint");
  });

  it("omits selectionHint when the selected id isn't in the scene", () => {
    useSelectionStore.setState({ selectedIds: ["ghost"] });
    const context = buildCanvasContext() as { canvasContext: string };
    const canvas = JSON.parse(context.canvasContext);
    expect(canvas).not.toHaveProperty("selectionHint");
  });

  it("omits selectionHint when nothing is selected", () => {
    useSelectionStore.setState({ selectedIds: [] });
    const context = buildCanvasContext() as { canvasContext: string };
    const canvas = JSON.parse(context.canvasContext);
    expect(canvas).not.toHaveProperty("selectionHint");
  });

  it("carries a stable userId in the request body", () => {
    const first = (buildCanvasContext() as { userId: string }).userId;
    expect(first).toBeTruthy();
    expect((buildCanvasContext() as { userId: string }).userId).toBe(first);
    expect(localStorage.getItem("pen.userId")).toBe(first);
  });

  it("includes selectedEmbedElement when a picked element's embed still exists in the scene", () => {
    useSceneStore.setState({
      nodesById: {
        ...useSceneStore.getState().nodesById,
        embed1: {
          id: "embed1",
          type: "embed",
          name: "Screen",
          x: 0,
          y: 0,
          width: 100,
          height: 80,
          htmlContent: "<div><button>Buy</button></div>",
        },
      },
      parentById: { ...useSceneStore.getState().parentById, embed1: null },
      rootIds: [...useSceneStore.getState().rootIds, "embed1"],
    } as never);
    useEmbedPickerStore.getState().selectElement({
      embedId: "embed1",
      path: "div:nth-of-type(1) > button:nth-of-type(1)",
      tagName: "button",
      classes: [],
      textPreview: "Buy",
      outerHtml: "<button>Buy</button>",
    });

    const context = buildCanvasContext() as { canvasContext: string };
    const canvas = JSON.parse(context.canvasContext);

    expect(canvas.selectedEmbedElement).toMatchObject({
      embedId: "embed1",
      path: "div:nth-of-type(1) > button:nth-of-type(1)",
      tagName: "button",
      outerHtml: "<button>Buy</button>",
    });
    expect(canvas.selectedEmbedElement.hint).toMatch(/embed1/);
    expect(canvas.selectedEmbedElement.hint).toMatch(/read_embed_html/);
  });

  it("omits selectedEmbedElement when there is no picked element", () => {
    const canvas = JSON.parse((buildCanvasContext() as { canvasContext: string }).canvasContext);
    expect(canvas).not.toHaveProperty("selectedEmbedElement");
  });

  it("omits selectedEmbedElement when the picked element's embed no longer exists in the scene", () => {
    useEmbedPickerStore.getState().selectElement({
      embedId: "ghost-embed",
      path: "div:nth-of-type(1)",
      tagName: "div",
      classes: [],
      textPreview: "",
      outerHtml: "<div></div>",
    });

    const canvas = JSON.parse((buildCanvasContext() as { canvasContext: string }).canvasContext);
    expect(canvas).not.toHaveProperty("selectedEmbedElement");
  });

  // FIR: an attached local repo (attach_local_repo, over WebMCP) used to be
  // invisible to the design agent — nothing in canvasContext hinted one
  // existed, so read_design_repo/read_repo_files serving from it instead of
  // GitHub was only reachable by accident.
  it("omits localRepo entirely when nothing is attached — a fresh session serializes byte-identically to before this existed", () => {
    const canvas = JSON.parse((buildCanvasContext() as { canvasContext: string }).canvasContext);
    expect(canvas).not.toHaveProperty("localRepo");
  });

  it("includes a compact localRepo marker (name/fileCount/treeSize only) once a repo is attached", () => {
    useRepoContextStore.getState().attach({
      name: "acme-app",
      tree: ["package.json", "src/index.ts", "README.md"],
      files: [
        { path: "package.json", content: '{"name":"acme-app"}' },
        { path: "src/index.ts", content: "export {};" },
      ],
    });

    const canvas = JSON.parse((buildCanvasContext() as { canvasContext: string }).canvasContext);

    expect(canvas.localRepo).toEqual({ name: "acme-app", fileCount: 2, treeSize: 3 });
    // Never file contents or the tree itself — only a name and counts.
    const serialized = (buildCanvasContext() as { canvasContext: string }).canvasContext;
    expect(serialized).not.toContain("export {};");
    expect(serialized).not.toContain("README.md");
  });
});

// clientCapabilities is the single switch that makes the browse_* tools
// exist at all — prepareChatTurn deletes them from the per-request tool set
// when it's falsy (root CLAUDE.md's "prompt-cache invariants" /
// docs/superpowers/specs/2026-09-18-builtin-browser-design.md). It's derived
// ONCE at useDesignChat's module scope from window.penDesktop, so this must
// control window.penDesktop *before* the module is imported — hence
// vi.resetModules() + a dynamic import rather than mutating window.penDesktop
// around the already-imported buildCanvasContext used by the rest of this
// file (see src/lib/__tests__/chatModels.test.ts for the same pattern).
describe("clientCapabilities", () => {
  afterEach(() => {
    delete window.penDesktop;
  });

  it("returns clientCapabilities at the top level of the body, with desktopBrowser true when window.penDesktop.browser is present at import time", async () => {
    window.penDesktop = {
      onMenuCommand: () => () => {},
      browser: {
        open: async () => ({}),
        act: async () => ({}),
        findImages: async () => ({}),
      },
    };
    vi.resetModules();
    const fresh = await import("@/hooks/useDesignChat");

    const context = fresh.buildCanvasContext() as Record<string, unknown>;

    expect(context.clientCapabilities).toEqual({ desktopBrowser: true });
    // Not nested inside the stringified canvasContext.
    const canvas = JSON.parse((context as { canvasContext: string }).canvasContext);
    expect(canvas.clientCapabilities).toBeUndefined();
  });

  it("desktopBrowser is false when window.penDesktop is absent at import time", async () => {
    delete window.penDesktop;
    vi.resetModules();
    const fresh = await import("@/hooks/useDesignChat");

    const context = fresh.buildCanvasContext() as Record<string, unknown>;

    expect(context.clientCapabilities).toEqual({ desktopBrowser: false });
  });
});

describe("resolveChatApiUrl", () => {
  it("falls back to /api/chat when no env override is set", () => {
    // Test env has neither VITE_AI_API_URL nor VITE_DESIGN_AGENT_BACKEND_URL.
    clearChatApiEnv();
    expect(resolveChatApiUrl()).toBe("/api/chat");
  });
});

describe("useDesignChat (hook + UI message stream)", () => {
  beforeEach(() => {
    clearChatApiEnv();
    resetStores();
    seedScene();
    seedVariables();
  });

  function sseResponse(chunks: Array<Record<string, unknown>>): Response {
    const body =
      chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") +
      "data: [DONE]\n\n";
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
    });
  }

  // A background chat must send ITS OWN model, not the foreground chat's:
  // `model` at the store root is only the active chat's value and openChat
  // overwrites it on every switch, so a session that reads the root value
  // would have its auto-continuations hijacked by an unrelated tab switch.
  it("sends the session's own model, not the active chat's", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      return sseResponse([
        { type: "start" },
        { type: "start-step" },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "ok" },
        { type: "text-end", id: "t1" },
        { type: "finish-step" },
        { type: "finish" },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    useChatStore.setState({
      chats: [
        {
          id: "tab-active",
          title: "A",
          model: "meta/muse-spark-1.3-contributor",
          parallelCount: 1,
          titleIsAuto: true,
          unread: false,
          needsAnswer: false,
          isBusy: false,
          updatedAt: 0,
        },
        {
          id: "tab-bg",
          title: "B",
          model: "qwen/qwen3.8-flash",
          parallelCount: 1,
          titleIsAuto: true,
          unread: false,
          needsAnswer: false,
          isBusy: false,
          updatedAt: 0,
        },
      ],
      activeChatId: "tab-active",
      model: "meta/muse-spark-1.3-contributor",
    });

    const { result } = renderHook(() => useDesignChat({ sessionId: "tab-bg" }));
    act(() => result.current.setInput("continue in background"));
    await act(async () => {
      result.current.sendMessage();
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(requests[0].model).toBe("qwen/qwen3.8-flash");
    expect(requests[0]).not.toHaveProperty("agentMode");
  });

  // OpenCode BYOK (pen-editor-backend docs/specs/2026-09-18-opencode-byok-
  // design.md): the key must ride along ONLY on a turn whose model is an
  // OpenCode route, and never on an ordinary OpenRouter turn — see
  // useDesignChat.ts's isOpenCodeModel/prepareSendMessagesRequest.
  describe("OpenCode key header", () => {
    afterEach(() => {
      clearOpenCodeKey();
    });

    it("attaches X-OpenCode-Key when the session's model is an OpenCode route", async () => {
      setOpenCodeKey("sk-test-opencode");
      const seenHeaders: Array<Headers> = [];
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        seenHeaders.push(new Headers(init?.headers));
        return sseResponse([
          { type: "start" },
          { type: "start-step" },
          { type: "finish-step" },
          { type: "finish" },
        ]);
      });
      vi.stubGlobal("fetch", fetchMock);

      useChatStore.setState({ model: "opencode-go/glm-5.3-flash" });

      const { result } = renderHook(() =>
        useDesignChat({ sessionId: "opencode-session" })
      );
      act(() => result.current.setInput("hello"));
      await act(async () => {
        result.current.sendMessage();
      });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

      expect(seenHeaders[0].get("X-OpenCode-Key")).toBe("sk-test-opencode");
    });

    it("does not attach X-OpenCode-Key on an ordinary OpenRouter turn", async () => {
      setOpenCodeKey("sk-test-opencode");
      const seenHeaders: Array<Headers> = [];
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        seenHeaders.push(new Headers(init?.headers));
        return sseResponse([
          { type: "start" },
          { type: "start-step" },
          { type: "finish-step" },
          { type: "finish" },
        ]);
      });
      vi.stubGlobal("fetch", fetchMock);

      useChatStore.setState({ model: "deepseek/deepseek-v4.1-flash" });

      const { result } = renderHook(() =>
        useDesignChat({ sessionId: "openrouter-session" })
      );
      act(() => result.current.setInput("hello"));
      await act(async () => {
        result.current.sendMessage();
      });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

      expect(seenHeaders[0].has("X-OpenCode-Key")).toBe(false);
    });

    it("does not attach a header for an OpenCode model when no key is stored", async () => {
      clearOpenCodeKey();
      const seenHeaders: Array<Headers> = [];
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        seenHeaders.push(new Headers(init?.headers));
        return sseResponse([
          { type: "start" },
          { type: "start-step" },
          { type: "finish-step" },
          { type: "finish" },
        ]);
      });
      vi.stubGlobal("fetch", fetchMock);

      useChatStore.setState({ model: "opencode-go/glm-5.3-flash" });

      const { result } = renderHook(() =>
        useDesignChat({ sessionId: "opencode-nokey-session" })
      );
      act(() => result.current.setInput("hello"));
      await act(async () => {
        result.current.sendMessage();
      });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

      expect(seenHeaders[0].has("X-OpenCode-Key")).toBe(false);
    });

    // Defect 4 (code review): prepareSendMessagesRequest used to return
    // `{ headers: { "X-OpenCode-Key": key } }` outright, which REPLACES the
    // transport's own base headers rather than adding to them (see
    // HttpChatTransport.sendMessages in node_modules/ai/dist/index.mjs —
    // `headers = preparedRequest.headers !== undefined ? ... : baseHeaders`,
    // no merge). Harmless while nothing else sets a header, but silently
    // dropping is exactly the kind of bug that's invisible until someone
    // adds a transport-level header later and it mysteriously vanishes only
    // on OpenCode turns. This spies on the real `DefaultChatTransport`
    // constructor to capture the actual `prepareSendMessagesRequest`
    // callback useDesignChat builds, then calls it directly the way
    // HttpChatTransport.sendMessages does — with a non-empty `headers`
    // (its computed base headers) — and asserts the base header survives
    // alongside X-OpenCode-Key.
    it("merges the transport's base headers with X-OpenCode-Key rather than replacing them", async () => {
      setOpenCodeKey("sk-test-merge");
      useChatStore.setState({ model: "opencode-go/glm-5.3-flash" });

      capturedTransportOptions.length = 0;
      renderHook(() => useDesignChat({ sessionId: "opencode-header-merge" }));
      const options = capturedTransportOptions.at(-1) as
        | { prepareSendMessagesRequest?: (args: unknown) => unknown }
        | undefined;
      expect(options?.prepareSendMessagesRequest).toBeTruthy();

      const prepared = (await options!.prepareSendMessagesRequest!({
        api: "/api/chat",
        id: "chat-1",
        messages: [],
        body: { model: "opencode-go/glm-5.3-flash" },
        headers: { "X-Transport-Base": "base-value" },
        credentials: undefined,
        requestMetadata: undefined,
        trigger: "submit-message",
        messageId: undefined,
      })) as { headers?: HeadersInit };

      const resultHeaders = new Headers(prepared.headers);
      expect(resultHeaders.get("X-Transport-Base")).toBe("base-value");
      expect(resultHeaders.get("X-OpenCode-Key")).toBe("sk-test-merge");
    });
  });

  it("executes a streamed tool call locally and sends the output back", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          url: String(input),
          body: JSON.parse(String(init?.body)),
        });
        if (requests.length === 1) {
          // First turn: the model calls get_variables
          return sseResponse([
            { type: "start" },
            { type: "start-step" },
            {
              type: "tool-input-available",
              toolCallId: "call-1",
              toolName: "get_variables",
              input: {},
            },
            { type: "finish-step" },
            { type: "finish" },
          ]);
        }
        // Second turn: the model answers with text
        return sseResponse([
          { type: "start" },
          { type: "start-step" },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "All done" },
          { type: "text-end", id: "t1" },
          { type: "finish-step" },
          { type: "finish" },
        ]);
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    // Must be stable across re-renders — useChat recreates the Chat (and
    // clears its messages) whenever the id changes.
    const sessionId = `test-session-${Date.now()}`;
    const { result } = renderHook(() => useDesignChat({ sessionId }));

    act(() => {
      result.current.setInput("list my variables");
    });
    await act(async () => {
      result.current.sendMessage();
    });

    // Tool output triggers an automatic follow-up request
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), {
      timeout: 5000,
    });
    await waitFor(() => expect(result.current.status).toBe("ready"), {
      timeout: 5000,
    });

    expect(requests[0].url).toBe("/api/chat");
    expect(requests[0].body.canvasContext).toBeTypeOf("string");
    expect(requests[0].body.model).toBe(useChatStore.getState().model);

    // The second request must contain the locally-executed tool result
    const secondMessages = requests[1].body.messages as Array<{
      role: string;
      parts: Array<Record<string, unknown>>;
    }>;
    const assistant = secondMessages.find((m) => m.role === "assistant");
    expect(assistant).toBeDefined();
    const toolPart = assistant!.parts.find(
      (p) => p.type === "tool-get_variables"
    );
    expect(toolPart).toBeDefined();
    expect(toolPart!.state).toBe("output-available");

    // Output is the real handler's serialization of the variable store
    const output = JSON.parse(String(toolPart!.output));
    expect(output.variables.map((v: { id: string }) => v.id)).toEqual([
      "var-primary",
      "var-radius",
    ]);

    // Trace-stitching contract (pen-editor-backend raw_traces.session_id):
    // every request of one conversation must carry the same non-empty id.
    expect(requests[0].body.id).toBeTypeOf("string");
    expect((requests[0].body.id as string).length).toBeGreaterThan(0);
    expect(requests[1].body.id).toBe(requests[0].body.id);

    // Final assistant message carries the streamed text
    const lastMessage = result.current.messages.at(-1);
    expect(lastMessage?.role).toBe("assistant");
    expect(
      lastMessage?.parts.some(
        (p) => p.type === "text" && p.text.includes("All done")
      )
    ).toBe(true);
  });

  it("does not auto-resolve ask_user; the turn pauses until addToolOutput", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        { type: "start" },
        { type: "start-step" },
        {
          type: "tool-input-available",
          toolCallId: "call-ask",
          toolName: "ask_user",
          input: {
            questions: [
              { id: "audience", label: "Audience?", type: "single",
                options: [{ value: "devs", label: "Developers" }] },
            ],
          },
        },
        { type: "finish-step" },
        { type: "finish" },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const sessionId = `ask-session-${Date.now()}`;
    const { result } = renderHook(() => useDesignChat({ sessionId }));

    act(() => result.current.setInput("design me a landing page"));
    await act(async () => {
      result.current.sendMessage();
    });

    // First (and only) request so far; ask_user must NOT trigger a follow-up.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Submitting the form answer resumes the turn.
    await act(async () => {
      result.current.addToolOutput({
        tool: "ask_user",
        toolCallId: "call-ask",
        output: JSON.stringify({ answers: [{ id: "audience", value: "devs" }] }),
      });
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 5000 });
  });

  // Research mode streams backend-executed MCP (dynamic) tools. The AI SDK MCP
  // client tags each tool chunk with `toolMetadata`; the UI message stream
  // schema must accept it, or the whole stream is rejected with a
  // TypeValidationError and the tool call hangs forever on "Running…".
  it("accepts a dynamic MCP tool chunk carrying toolMetadata", async () => {
    // The tool part arrives already resolved (`tool-output-available` with no
    // `providerExecuted`), so `lastAssistantMessageIsCompleteWithToolCalls`
    // fires and the hook auto-continues exactly once — model the backend's
    // second turn as the plain-text answer it really is. A mock that replayed
    // the tool call on every request would never terminate: as of ai 6.0.280
    // `updateDynamicToolPart` looks the tool call up within the *current step*
    // instead of the whole message, so a replayed `toolCallId` appends a fresh
    // resolved dynamic-tool part to each new step and re-arms the predicate
    // forever, growing the request body until the worker heap is gone.
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length > 1) {
        return sseResponse([
          { type: "start" },
          { type: "start-step" },
          { type: "text-start", id: "t2" },
          { type: "text-delta", id: "t2", delta: "Here is what I found" },
          { type: "text-end", id: "t2" },
          { type: "finish-step" },
          { type: "finish" },
        ]);
      }
      return sseResponse([
        { type: "start" },
        { type: "start-step" },
        {
          type: "tool-input-start",
          toolCallId: "mcp-1",
          toolName: "mobbin_search_screens",
          dynamic: true,
        },
        {
          type: "tool-input-available",
          toolCallId: "mcp-1",
          toolName: "mobbin_search_screens",
          input: { query: "onboarding", platform: "web" },
          providerMetadata: { openrouter: { reasoning_details: [] } },
          toolMetadata: { clientName: "ai-sdk-mcp-client" },
          dynamic: true,
          title: "mobbin_search_screens",
        },
        {
          type: "tool-output-available",
          toolCallId: "mcp-1",
          output: { screens: [{ id: "s1" }] },
          dynamic: true,
        },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "Found some screens" },
        { type: "text-end", id: "t1" },
        { type: "finish-step" },
        { type: "finish" },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const sessionId = `test-session-mcp-${Date.now()}`;
    const { result } = renderHook(() => useDesignChat({ sessionId }));

    act(() => {
      result.current.setInput("find onboarding screens");
    });
    await act(async () => {
      result.current.sendMessage();
    });

    // The stream must parse cleanly — no TypeValidationError on toolMetadata.
    await waitFor(() => expect(result.current.status).toBe("ready"), {
      timeout: 5000,
    });
    expect(result.current.error).toBeUndefined();

    // One turn for the tool call, one auto-continuation carrying its result —
    // and then it stops.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const toolPart = result.current.messages
      .filter((m) => m.role === "assistant")
      .flatMap((m) => m.parts)
      .find((p) => p.type === "dynamic-tool") as
      | { state?: string; toolName?: string }
      | undefined;
    expect(toolPart).toBeDefined();
    expect(toolPart!.toolName).toBe("mobbin_search_screens");
    expect(toolPart!.state).toBe("output-available");
  });

  describe("Mobbin token header", () => {
    const MOBBIN_KEYS = [
      "pen.mobbin.clientId",
      "pen.mobbin.accessToken",
      "pen.mobbin.refreshToken",
      "pen.mobbin.expiresAt",
    ];

    afterEach(() => {
      for (const key of MOBBIN_KEYS) localStorage.removeItem(key);
    });

    it("sends X-Mobbin-Token when connected, and never in the request body", async () => {
      localStorage.setItem("pen.mobbin.clientId", "client-1");
      localStorage.setItem("pen.mobbin.accessToken", "mobbin-secret-token");
      localStorage.setItem("pen.mobbin.expiresAt", String(Date.now() + 60 * 60 * 1000));

      const requests: Array<{ headers: Headers; bodyText: string }> = [];
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          headers: new Headers(init?.headers),
          bodyText: String(init?.body),
        });
        return sseResponse([
          { type: "start" },
          { type: "start-step" },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "ok" },
          { type: "text-end", id: "t1" },
          { type: "finish-step" },
          { type: "finish" },
        ]);
      });
      vi.stubGlobal("fetch", fetchMock);

      const sessionId = `test-session-mobbin-on-${Date.now()}`;
      const { result } = renderHook(() => useDesignChat({ sessionId }));
      act(() => result.current.setInput("find onboarding screens"));
      await act(async () => {
        result.current.sendMessage();
      });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

      expect(requests[0].headers.get("X-Mobbin-Token")).toBe("mobbin-secret-token");
      expect(requests[0].bodyText).not.toContain("mobbin-secret-token");
    });

    it("sends no X-Mobbin-Token header when not connected", async () => {
      const requests: Array<{ headers: Headers }> = [];
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ headers: new Headers(init?.headers) });
        return sseResponse([
          { type: "start" },
          { type: "start-step" },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "ok" },
          { type: "text-end", id: "t1" },
          { type: "finish-step" },
          { type: "finish" },
        ]);
      });
      vi.stubGlobal("fetch", fetchMock);

      const sessionId = `test-session-mobbin-off-${Date.now()}`;
      const { result } = renderHook(() => useDesignChat({ sessionId }));
      act(() => result.current.setInput("find onboarding screens"));
      await act(async () => {
        result.current.sendMessage();
      });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

      expect(requests[0].headers.has("X-Mobbin-Token")).toBe(false);
    });

    // The coordinator's correction: an expired token with no refresh token
    // must not be silently sent — it clears itself via disconnect() and the
    // request goes out with no Mobbin header at all, rather than a stale one
    // that would 401 against Mobbin mid-turn.
    it("drops the header and clears credentials when expired with no refresh token", async () => {
      localStorage.setItem("pen.mobbin.clientId", "client-1");
      localStorage.setItem("pen.mobbin.accessToken", "stale-token");
      localStorage.setItem("pen.mobbin.expiresAt", String(Date.now() - 1000));

      const requests: Array<{ headers: Headers }> = [];
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        // No /api/mobbin/refresh call should happen — there is no refresh
        // token to use — but guard it anyway so a regression fails loudly
        // instead of hanging.
        if (String(input).includes("/api/mobbin/refresh")) {
          throw new Error("unexpected refresh call with no refresh token");
        }
        requests.push({ headers: new Headers(init?.headers) });
        return sseResponse([
          { type: "start" },
          { type: "start-step" },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "ok" },
          { type: "text-end", id: "t1" },
          { type: "finish-step" },
          { type: "finish" },
        ]);
      });
      vi.stubGlobal("fetch", fetchMock);

      const sessionId = `test-session-mobbin-expired-${Date.now()}`;
      const { result } = renderHook(() => useDesignChat({ sessionId }));
      act(() => result.current.setInput("find onboarding screens"));
      await act(async () => {
        result.current.sendMessage();
      });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

      expect(requests[0].headers.has("X-Mobbin-Token")).toBe(false);
      expect(localStorage.getItem("pen.mobbin.accessToken")).toBeNull();
    });

    // Finding #9 regression: prepareSendMessagesRequest used to also set a
    // best-effort X-Mobbin-Token header synchronously from whatever access
    // token happened to be in storage at send time. That's ALWAYS the STALE
    // value once a refresh is needed — only withMobbinAuthHeader's async,
    // expiry-aware getValidAccessToken() ever sees the refreshed one. This
    // pins the outgoing header to the refreshed token, which would fail if
    // the removed synchronous header ever reappeared and (per the AI SDK's
    // own "headers replaces baseHeaders wholesale" semantics) won the race.
    it("sends the freshly refreshed token, never the stale one that was in storage at send time", async () => {
      localStorage.setItem("pen.mobbin.clientId", "client-1");
      localStorage.setItem("pen.mobbin.accessToken", "stale-token");
      localStorage.setItem("pen.mobbin.refreshToken", "refresh-1");
      localStorage.setItem("pen.mobbin.expiresAt", String(Date.now() - 1000));

      const requests: Array<{ headers: Headers }> = [];
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/api/mobbin/refresh")) {
          return new Response(
            JSON.stringify({
              accessToken: "refreshed-token",
              refreshToken: "refresh-2",
              expiresIn: 3600,
            }),
            { status: 200 },
          );
        }
        requests.push({ headers: new Headers(init?.headers) });
        return sseResponse([
          { type: "start" },
          { type: "start-step" },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "ok" },
          { type: "text-end", id: "t1" },
          { type: "finish-step" },
          { type: "finish" },
        ]);
      });
      vi.stubGlobal("fetch", fetchMock);

      const sessionId = `test-session-mobbin-refresh-${Date.now()}`;
      const { result } = renderHook(() => useDesignChat({ sessionId }));
      act(() => result.current.setInput("find onboarding screens"));
      await act(async () => {
        result.current.sendMessage();
      });
      await waitFor(() => expect(requests.length).toBe(1));

      expect(requests[0].headers.get("X-Mobbin-Token")).toBe("refreshed-token");
    });
  });

  it("fails locally without a network request when offline", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", { onLine: false });

    const sessionId = `test-session-offline-${Date.now()}`;
    const { result } = renderHook(() => useDesignChat({ sessionId }));

    act(() => {
      result.current.setInput("do something");
    });
    act(() => {
      const didSend = result.current.sendMessage();
      expect(didSend).toBe(false);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.error?.message).toMatch(/offline/i);
    // The unsent draft is preserved so the user can retry once back online.
    expect(result.current.input).toBe("do something");

    act(() => {
      result.current.clearError();
    });
    expect(result.current.error).toBeUndefined();
  });

  // Regression: a parallel-tab launch (ChatPanel.handleSubmit -> queueLaunchPayload
  // for extra tabs) used to be consumed from the store the instant the tab's
  // useDesignChat mounted, even while offline — sendPayload's offline guard
  // then rejected it, and the one-shot consumeLaunchPayload had already
  // deleted it, destroying the queued message permanently.
  it("keeps a queued launch payload queued while offline, and sends it once back online", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        { type: "start" },
        { type: "start-step" },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "ok" },
        { type: "text-end", id: "t1" },
        { type: "finish-step" },
        { type: "finish" },
      ])
    );
    vi.stubGlobal("fetch", fetchMock);
    const nav = { onLine: false };
    vi.stubGlobal("navigator", nav);

    const sessionId = `test-session-queued-${Date.now()}`;
    useChatStore.getState().queueLaunchPayload(sessionId, {
      text: "queued while offline",
    });

    renderHook(() => useDesignChat({ sessionId }));

    // Give the mount effect a tick to (not) run, then assert the payload was
    // neither sent nor deleted from the queue.
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useChatStore.getState().launchQueue[sessionId]).toEqual({
      text: "queued while offline",
    });

    // Connectivity returns — the effect re-runs (isOnline dependency) and
    // consumes+sends the still-queued payload.
    nav.onLine = true;
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(useChatStore.getState().launchQueue[sessionId]).toBeUndefined();
  });

  // Regression (showcase handoff): the "ask the design agent" composer on "/"
  // navigates to the editor and queues a launch payload that is sent the
  // instant the chat mounts — strictly before GET /api/models can answer. The
  // send used to be held back until the list landed, because a fallback id
  // the backend didn't allow came back as a 400. It isn't any more: the
  // backend now IGNORES an id outside its list and runs its own default, so
  // the worst case is a turn on the default model instead of a dead one.
  it("sends a queued launch payload without waiting for GET /api/models", async () => {
    const chatCalls: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      // Never resolves — the send must not depend on it.
      if (String(input).includes("/api/models")) return new Promise<Response>(() => {});
      chatCalls.push(JSON.parse(String(init?.body)));
      return sseResponse([
        { type: "start" },
        { type: "start-step" },
        { type: "finish-step" },
        { type: "finish" },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { loadModels } = await import("@/lib/chatModels");
    void loadModels();

    const sessionId = `test-session-models-${Date.now()}`;
    useChatStore.getState().queueLaunchPayload(sessionId, { text: "make me an app" });
    renderHook(() => useDesignChat({ sessionId }));

    await waitFor(() => expect(chatCalls).toHaveLength(1));
    // Whatever the store holds without the backend ever answering — the
    // hardcoded fallback, or a selection made earlier in the session.
    expect(chatCalls[0].model).toBe(useChatStore.getState().model);
    expect(useChatStore.getState().launchQueue[sessionId]).toBeUndefined();
  });

  // RTL's `waitFor` polls via `setInterval`, which is itself mocked once
  // `vi.useFakeTimers()` is active — nothing ever advances it, so a plain
  // `waitFor` hangs until the test timeout. Poll manually instead, ticking
  // the fake clock a little each iteration so pending microtasks (e.g. the
  // rejected-fetch retry catch handler) get a chance to flush.
  async function waitForFakeTimers(
    assertion: () => void,
    { timeoutMs = 2000, stepMs = 10 }: { timeoutMs?: number; stepMs?: number } = {},
  ): Promise<void> {
    let elapsed = 0;
    for (;;) {
      try {
        assertion();
        return;
      } catch (err) {
        if (elapsed >= timeoutMs) {
          throw err;
        }
        await act(async () => {
          await vi.advanceTimersByTimeAsync(stepMs);
        });
        elapsed += stepMs;
      }
    }
  }

  it("auto-retries network failures and recovers, exposing retryState", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockImplementationOnce(async () =>
        sseResponse([
          { type: "start" },
          { type: "start-step" },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "recovered" },
          { type: "text-end", id: "t1" },
          { type: "finish-step" },
          { type: "finish" },
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDesignChat({ sessionId: "s1" }));
    expect(result.current.retryState).toBeNull();

    act(() => result.current.setInput("hello"));
    await act(async () => {
      result.current.sendMessage();
    });

    await waitForFakeTimers(() =>
      expect(result.current.retryState).toMatchObject({
        attempt: 1,
        maxAttempts: 3,
        reason: "network",
      }),
    );
    // No red error while retrying.
    expect(result.current.error).toBeUndefined();

    // Backoff before retry 2 is at most base * 2**1 = 2000ms (jittered down
    // by up to 25%). Advance in small steps via waitForFakeTimers so the
    // intermediate attempt:2 state is observed rather than skipped over —
    // a single large jump would also cross retry 3's shorter backoff and
    // land straight on the final success.
    await waitForFakeTimers(() =>
      expect(result.current.retryState).toMatchObject({
        attempt: 2,
        maxAttempts: 3,
        reason: "network",
      }),
    );

    await waitForFakeTimers(() => expect(result.current.retryState).toBeNull());
    await waitForFakeTimers(() => {
      const assistant = result.current.messages.find((m) => m.role === "assistant");
      expect(assistant).toBeDefined();
    });
    expect(result.current.error).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  // Regression coverage for the "chat message queue" feature: sending while
  // the agent is busy (status "submitted"/"streaming") must not drop the
  // message — it goes into chatStore's messageQueue and is auto-sent, one at
  // a time, once the session returns to "ready".
  describe("message queue", () => {
    it("queues sendPayload calls made while a request is in flight, and auto-sends the first once ready", async () => {
      let resolveFirst: ((res: Response) => void) | undefined;
      const firstResponse = new Promise<Response>((resolve) => {
        resolveFirst = resolve;
      });
      const requests: Array<Record<string, unknown>> = [];
      const fetchMock = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body));
          requests.push(body);
          if (requests.length === 1) {
            return firstResponse;
          }
          return sseResponse([
            { type: "start" },
            { type: "start-step" },
            { type: "text-start", id: "t2" },
            { type: "text-delta", id: "t2", delta: "second reply" },
            { type: "text-end", id: "t2" },
            { type: "finish-step" },
            { type: "finish" },
          ]);
        }
      );
      vi.stubGlobal("fetch", fetchMock);

      const sessionId = `queue-session-${Date.now()}`;
      const { result } = renderHook(() => useDesignChat({ sessionId }));

      act(() => result.current.setInput("first message"));
      await act(async () => {
        result.current.sendMessage();
      });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      // Still mid-flight — the first request hasn't resolved yet.
      expect(["submitted", "streaming"]).toContain(result.current.status);

      // A second send while busy must be accepted (queued), not dropped.
      // Exercised via submitLaunchPayload (what ChatInput's onSubmit calls),
      // rather than sendMessage/input, since the first send already cleared
      // `input`.
      let queuedOk = false;
      act(() => {
        queuedOk = result.current.submitLaunchPayload({ text: "second message" });
      });
      expect(queuedOk).toBe(true);

      expect(useChatStore.getState().messageQueue[sessionId]).toHaveLength(1);
      expect(
        useChatStore.getState().messageQueue[sessionId]?.[0].payload.text
      ).toBe("second message");
      expect(result.current.queuedMessages).toHaveLength(1);
      expect(result.current.queuedMessages[0].payload.text).toBe("second message");
      // Only one network request has gone out so far — the queued message
      // was NOT sent immediately.
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Resolve the first (in-flight) request; the session returns to
      // "ready", which should auto-send the queued message.
      await act(async () => {
        resolveFirst!(
          sseResponse([
            { type: "start" },
            { type: "start-step" },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "first reply" },
            { type: "text-end", id: "t1" },
            { type: "finish-step" },
            { type: "finish" },
          ])
        );
      });

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), {
        timeout: 5000,
      });
      await waitFor(() => expect(result.current.status).toBe("ready"), {
        timeout: 5000,
      });

      // The queue is drained.
      expect(useChatStore.getState().messageQueue[sessionId]).toBeUndefined();
      expect(result.current.queuedMessages).toHaveLength(0);
    });

    // Regression for FIX 1: the auto-drain effect must peek the queue and
    // only remove the item once sendPayload actually succeeds. Previously it
    // dequeued (removed) first and sent second, so a `false` return (e.g. an
    // offline race) silently lost the message forever.
    it("keeps a queued message in the queue when sendPayload fails, and sends it once the condition clears", async () => {
      let resolveFirst: ((res: Response) => void) | undefined;
      const firstResponse = new Promise<Response>((resolve) => {
        resolveFirst = resolve;
      });
      const requests: Array<Record<string, unknown>> = [];
      const fetchMock = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body));
          requests.push(body);
          if (requests.length === 1) {
            return firstResponse;
          }
          return sseResponse([
            { type: "start" },
            { type: "start-step" },
            { type: "text-start", id: "t2" },
            { type: "text-delta", id: "t2", delta: "second reply" },
            { type: "text-end", id: "t2" },
            { type: "finish-step" },
            { type: "finish" },
          ]);
        }
      );
      vi.stubGlobal("fetch", fetchMock);
      // Control connectivity through a stubbed navigator (whose `onLine` the
      // live `isOffline()` check reads) plus the "offline"/"online" events
      // that drive useOnlineStatus's `isOnline` state — keeping the two in
      // sync, exactly as a real browser does.
      const nav = { onLine: true };
      vi.stubGlobal("navigator", nav);

      const sessionId = `queue-offline-race-${Date.now()}`;
      const { result } = renderHook(() => useDesignChat({ sessionId }));

      act(() => result.current.setInput("first message"));
      await act(async () => {
        result.current.sendMessage();
      });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(["submitted", "streaming"]).toContain(result.current.status);

      act(() => {
        result.current.submitLaunchPayload({ text: "second message" });
      });
      expect(useChatStore.getState().messageQueue[sessionId]).toHaveLength(1);
      const queuedId = useChatStore.getState().messageQueue[sessionId]![0].id;

      // Go offline before the in-flight request settles: nav.onLine flips and
      // the "offline" event flips useOnlineStatus's isOnline to false.
      act(() => {
        nav.onLine = false;
        window.dispatchEvent(new Event("offline"));
      });
      await act(async () => {
        resolveFirst!(
          sseResponse([
            { type: "start" },
            { type: "start-step" },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "first reply" },
            { type: "text-end", id: "t1" },
            { type: "finish-step" },
            { type: "finish" },
          ])
        );
      });
      await waitFor(() => expect(result.current.status).toBe("ready"));

      // Session is "ready" but offline — the drain effect bails before any
      // send, so the message must still be in the queue, with its original
      // id, not lost.
      expect(useChatStore.getState().messageQueue[sessionId]).toHaveLength(1);
      expect(useChatStore.getState().messageQueue[sessionId]![0].id).toBe(queuedId);
      expect(useChatStore.getState().messageQueue[sessionId]![0].payload.text).toBe(
        "second message"
      );
      // Only the first request has gone out — the queued one was never sent.
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Connectivity genuinely returns — the "online" event flips `isOnline`
      // back to true, the effect reruns, and the still-queued message is
      // finally sent.
      act(() => {
        nav.onLine = true;
        window.dispatchEvent(new Event("online"));
      });

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), {
        timeout: 5000,
      });
      expect(requests[1].messages).toBeDefined();
      await waitFor(() =>
        expect(useChatStore.getState().messageQueue[sessionId]).toBeUndefined()
      );
    });

    it("removeQueuedMessage removes an item before it gets auto-sent", async () => {
      // A request that never resolves keeps the session in "submitted" so
      // the queued item is never auto-drained during this test.
      const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
      vi.stubGlobal("fetch", fetchMock);

      const sessionId = `queue-remove-session-${Date.now()}`;
      const { result } = renderHook(() => useDesignChat({ sessionId }));

      act(() => result.current.setInput("first message"));
      await act(async () => {
        result.current.sendMessage();
      });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(["submitted", "streaming"]).toContain(result.current.status);

      act(() => {
        result.current.submitLaunchPayload({ text: "will be removed" });
      });
      expect(result.current.queuedMessages).toHaveLength(1);
      const id = result.current.queuedMessages[0].id;

      act(() => result.current.removeQueuedMessage(id));

      expect(result.current.queuedMessages).toHaveLength(0);
      expect(useChatStore.getState().messageQueue[sessionId]).toBeUndefined();
    });
  });

  it("surfaces the error and clears retryState after retries are exhausted", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDesignChat({ sessionId: "s1" }));
    act(() => result.current.setInput("hello"));
    await act(async () => {
      result.current.sendMessage();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000); // 3 pauses
    });

    await waitForFakeTimers(() => expect(result.current.error).toBeDefined());
    expect(result.current.retryState).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(4); // initial + 3 retries
  });

  // Task 7: the hook observes partial `draw_vector` tool input while it
  // streams (before the final tool-input-available chunk), stages it in the
  // transient preview store, and clears it on every terminal path.
  describe("streaming AI vector previews", () => {
    beforeEach(() => {
      useAiVectorPreviewStore.getState().reset();
    });

    afterEach(() => {
      useAiVectorPreviewStore.getState().reset();
    });

    // Builds a `Response` whose SSE body is pushed chunk-by-chunk under test
    // control (real ReadableStream, real delays), rather than one static
    // string body — this is what lets the test assert on preview state
    // BEFORE the final tool-input-available chunk is sent.
    function controlledSseResponse() {
      let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controllerRef = controller;
        },
      });
      const push = (chunk: Record<string, unknown>) => {
        controllerRef!.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      };
      const close = () => {
        controllerRef!.enqueue(encoder.encode("data: [DONE]\n\n"));
        controllerRef!.close();
      };
      const response = new Response(stream, {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-vercel-ai-ui-message-stream": "v1",
        },
      });
      return { response, push, close, controller: controllerRef! };
    }

    function sseResponse(chunks: Array<Record<string, unknown>>): Response {
      const body =
        chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") +
        "data: [DONE]\n\n";
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-vercel-ai-ui-message-stream": "v1",
        },
      });
    }

    // A short real-time yield so the AI SDK's stream reader gets a turn to
    // process enqueued chunks and flush the throttled React update.
    async function flushStream(ms = 20) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
      });
    }

    it("shows a preview before the final chunk, executes the handler once, and clears the preview on completion", async () => {
      const { response: firstResponse, push, close } = controlledSseResponse();
      const requests: Array<Record<string, unknown>> = [];
      const fetchMock = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          requests.push(JSON.parse(String(init?.body)));
          if (requests.length === 1) {
            return firstResponse;
          }
          return sseResponse([
            { type: "start" },
            { type: "start-step" },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "Drawn" },
            { type: "text-end", id: "t1" },
            { type: "finish-step" },
            { type: "finish" },
          ]);
        }
      );
      vi.stubGlobal("fetch", fetchMock);

      const sessionId = `vector-session-${Date.now()}`;
      const { result } = renderHook(() => useDesignChat({ sessionId }));

      act(() => result.current.setInput("draw a leaf"));
      await act(async () => {
        result.current.sendMessage();
      });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

      push({ type: "start" });
      push({ type: "start-step" });
      push({ type: "tool-input-start", toolCallId: "vector-1", toolName: "draw_vector" });
      push({
        type: "tool-input-delta",
        toolCallId: "vector-1",
        inputTextDelta: '{"name":"Leaf","commands":"M(10,10)\\n',
      });
      await flushStream();
      push({
        type: "tool-input-delta",
        toolCallId: "vector-1",
        inputTextDelta: 'L(20,20)\\n',
      });
      await flushStream();

      // Preview must exist BEFORE the final chunk, and the scene must not
      // have a committed path node yet.
      await waitFor(() => {
        const key = vectorPreviewKey(sessionId, "vector-1");
        const draft = useAiVectorPreviewStore.getState().drafts[key];
        expect(draft).toBeDefined();
        expect(draft!.points.length).toBeGreaterThanOrEqual(2);
      });
      expect(
        Object.values(useSceneStore.getState().nodesById).some(
          (n) => n.type === "path"
        )
      ).toBe(false);

      const fetchCallsBeforeFinal = fetchMock.mock.calls.length;

      await act(async () => {
        push({
          type: "tool-input-delta",
          toolCallId: "vector-1",
          inputTextDelta: 'END()"}',
        });
        push({
          type: "tool-input-available",
          toolCallId: "vector-1",
          toolName: "draw_vector",
          input: { name: "Leaf", commands: "M(10,10)\nL(20,20)\nEND()" },
        });
        push({ type: "finish-step" });
        push({ type: "finish" });
        close();
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      // Exactly one automatic continuation request for the resolved tool call.
      await waitFor(() =>
        expect(fetchMock.mock.calls.length).toBe(fetchCallsBeforeFinal + 1)
      );
      await waitFor(() => expect(result.current.status).toBe("ready"));
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // The handler ran exactly once — one committed path node.
      expect(
        Object.values(useSceneStore.getState().nodesById).filter(
          (n) => n.type === "path"
        )
      ).toHaveLength(1);

      // Preview cleared after commit.
      const key = vectorPreviewKey(sessionId, "vector-1");
      expect(useAiVectorPreviewStore.getState().drafts[key]).toBeUndefined();

      const secondMessages = requests[1].messages as Array<{
        role: string;
        parts: Array<Record<string, unknown>>;
      }>;
      const assistant = secondMessages.find((m) => m.role === "assistant");
      const toolPart = assistant!.parts.find(
        (p) => p.type === "tool-draw_vector"
      );
      expect(toolPart).toBeDefined();
      expect(toolPart!.state).toBe("output-available");
      const output = JSON.parse(String(toolPart!.output));
      expect(output.success).toBe(true);
    });

    it("isolates previews between two sessions using the same tool call id", async () => {
      const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
      vi.stubGlobal("fetch", fetchMock);

      const sessionA = `vector-a-${Date.now()}`;
      const sessionB = `vector-b-${Date.now()}`;
      const { result: resultA } = renderHook(() =>
        useDesignChat({ sessionId: sessionA })
      );
      const { result: resultB } = renderHook(() =>
        useDesignChat({ sessionId: sessionB })
      );

      act(() => resultA.current.setInput("draw a"));
      await act(async () => {
        resultA.current.sendMessage();
      });
      act(() => resultB.current.setInput("draw b"));
      await act(async () => {
        resultB.current.sendMessage();
      });

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

      act(() => {
        useAiVectorPreviewStore.getState().upsert({
          sessionId: sessionA,
          toolCallId: "same-call",
          name: "A",
          commandText: "M(0,0)\nL(1,1)\n",
          phase: "streaming",
          receivedDuringStreaming: true,
          points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
          contours: [{ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], closed: false }],
          geometry: "M 0 0 L 1 1",
          bounds: { x: 0, y: 0, width: 1, height: 1 },
          closed: false,
          ended: false,
          warnings: [],
        });
      });

      expect(
        useAiVectorPreviewStore.getState().drafts[vectorPreviewKey(sessionA, "same-call")]
      ).toBeDefined();
      expect(
        useAiVectorPreviewStore.getState().drafts[vectorPreviewKey(sessionB, "same-call")]
      ).toBeUndefined();
    });

    it("stop clears only the owning session's previews", async () => {
      const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
      vi.stubGlobal("fetch", fetchMock);

      const sessionA = `vector-stop-a-${Date.now()}`;
      const sessionB = `vector-stop-b-${Date.now()}`;
      const { result: resultA } = renderHook(() =>
        useDesignChat({ sessionId: sessionA })
      );
      renderHook(() => useDesignChat({ sessionId: sessionB }));

      act(() => {
        useAiVectorPreviewStore.getState().upsert({
          sessionId: sessionA,
          toolCallId: "call-a",
          name: "A",
          commandText: "M(0,0)\nL(1,1)\n",
          phase: "streaming",
          receivedDuringStreaming: true,
          points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
          contours: [{ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], closed: false }],
          geometry: "M 0 0 L 1 1",
          bounds: { x: 0, y: 0, width: 1, height: 1 },
          closed: false,
          ended: false,
          warnings: [],
        });
        useAiVectorPreviewStore.getState().upsert({
          sessionId: sessionB,
          toolCallId: "call-b",
          name: "B",
          commandText: "M(0,0)\nL(1,1)\n",
          phase: "streaming",
          receivedDuringStreaming: true,
          points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
          contours: [{ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], closed: false }],
          geometry: "M 0 0 L 1 1",
          bounds: { x: 0, y: 0, width: 1, height: 1 },
          closed: false,
          ended: false,
          warnings: [],
        });
      });

      act(() => {
        resultA.current.stop();
      });

      expect(
        useAiVectorPreviewStore.getState().drafts[vectorPreviewKey(sessionA, "call-a")]
      ).toBeUndefined();
      expect(
        useAiVectorPreviewStore.getState().drafts[vectorPreviewKey(sessionB, "call-b")]
      ).toBeDefined();
    });

    it("the registered abort controller clears this session's previews", async () => {
      const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
      vi.stubGlobal("fetch", fetchMock);

      const sessionId = `vector-abort-${Date.now()}`;
      renderHook(() => useDesignChat({ sessionId }));

      act(() => {
        useAiVectorPreviewStore.getState().upsert({
          sessionId,
          toolCallId: "call-abort",
          name: "A",
          commandText: "M(0,0)\nL(1,1)\n",
          phase: "streaming",
          receivedDuringStreaming: true,
          points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
          contours: [{ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], closed: false }],
          geometry: "M 0 0 L 1 1",
          bounds: { x: 0, y: 0, width: 1, height: 1 },
          closed: false,
          ended: false,
          warnings: [],
        });
      });

      act(() => {
        useChatStore.getState().abortControllers[sessionId]?.abort();
      });

      expect(
        useAiVectorPreviewStore.getState().drafts[vectorPreviewKey(sessionId, "call-abort")]
      ).toBeUndefined();
    });

    it("clears previews when chat.status becomes error", async () => {
      vi.useFakeTimers();
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockRejectedValue(new TypeError("Failed to fetch"));
      vi.stubGlobal("fetch", fetchMock);

      const sessionId = `vector-error-${Date.now()}`;
      const { result } = renderHook(() => useDesignChat({ sessionId }));

      act(() => {
        useAiVectorPreviewStore.getState().upsert({
          sessionId,
          toolCallId: "call-err",
          name: "A",
          commandText: "M(0,0)\nL(1,1)\n",
          phase: "streaming",
          receivedDuringStreaming: true,
          points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
          contours: [{ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], closed: false }],
          geometry: "M 0 0 L 1 1",
          bounds: { x: 0, y: 0, width: 1, height: 1 },
          closed: false,
          ended: false,
          warnings: [],
        });
      });

      act(() => result.current.setInput("hello"));
      await act(async () => {
        result.current.sendMessage();
      });

      // createRetryingFetch retries a few times (real delays under fake
      // timers) before the chat settles into "error" — mirror the pattern
      // used by the "surfaces the error…" test above.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });

      await waitForFakeTimers(() => expect(result.current.status).toBe("error"));

      expect(
        useAiVectorPreviewStore.getState().drafts[vectorPreviewKey(sessionId, "call-err")]
      ).toBeUndefined();
    });

    it("clears this session's previews on unmount", async () => {
      const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
      vi.stubGlobal("fetch", fetchMock);

      const sessionId = `vector-unmount-${Date.now()}`;
      const { unmount } = renderHook(() => useDesignChat({ sessionId }));

      act(() => {
        useAiVectorPreviewStore.getState().upsert({
          sessionId,
          toolCallId: "call-unmount",
          name: "A",
          commandText: "M(0,0)\nL(1,1)\n",
          phase: "streaming",
          receivedDuringStreaming: true,
          points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
          contours: [{ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], closed: false }],
          geometry: "M 0 0 L 1 1",
          bounds: { x: 0, y: 0, width: 1, height: 1 },
          closed: false,
          ended: false,
          warnings: [],
        });
      });

      unmount();

      expect(
        useAiVectorPreviewStore.getState().drafts[
          vectorPreviewKey(sessionId, "call-unmount")
        ]
      ).toBeUndefined();
    });

    it("does not clear the preview on an ordinary ready transition (final handler owns commit-before-clear)", async () => {
      // Regression guard: ready must not be treated as a terminal-clear path.
      // Simulate a plain text-only turn completing (chat.status -> "ready")
      // while an unrelated preview for a DIFFERENT (still in-flight) call
      // remains staged; it must survive the ready transition.
      const fetchMock = vi.fn(async () =>
        sseResponse([
          { type: "start" },
          { type: "start-step" },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "ok" },
          { type: "text-end", id: "t1" },
          { type: "finish-step" },
          { type: "finish" },
        ])
      );
      vi.stubGlobal("fetch", fetchMock);

      const sessionId = `vector-ready-${Date.now()}`;
      const { result } = renderHook(() => useDesignChat({ sessionId }));

      act(() => {
        useAiVectorPreviewStore.getState().upsert({
          sessionId,
          toolCallId: "call-ready",
          name: "A",
          commandText: "M(0,0)\nL(1,1)\n",
          phase: "streaming",
          receivedDuringStreaming: true,
          points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
          contours: [{ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], closed: false }],
          geometry: "M 0 0 L 1 1",
          bounds: { x: 0, y: 0, width: 1, height: 1 },
          closed: false,
          ended: false,
          warnings: [],
        });
      });

      act(() => result.current.setInput("hi"));
      await act(async () => {
        result.current.sendMessage();
      });

      await waitFor(() => expect(result.current.status).toBe("ready"));

      expect(
        useAiVectorPreviewStore.getState().drafts[vectorPreviewKey(sessionId, "call-ready")]
      ).toBeDefined();
    });

    // Regression: AI SDK v6 deliberately keeps the partial assistant message
    // (and its still-`input-streaming` tool part) in `chat.messages` after
    // `Chat.stop()` — that's why `convertToModelMessages` has
    // `ignoreIncompleteToolCalls`. clearVectorPreviewSession wipes drafts AND
    // finalizedKeys on stop, so nothing blocks a later re-upsert. When the
    // user then sends a follow-up message, `chat.messages` still contains
    // that stale `input-streaming` part, and the staging effect re-runs on
    // every messages update — it must NOT resurrect a preview for an
    // abandoned tool call.
    it("does not resurrect a preview for a stale input-streaming part after stop + follow-up send", async () => {
      const { response: firstResponse, push, controller: firstController } =
        controlledSseResponse();
      const requests: Array<Record<string, unknown>> = [];
      const fetchMock = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          requests.push(JSON.parse(String(init?.body)));
          if (requests.length === 1) {
            // Mirror what a real fetch() does: aborting the request signal
            // errors the response body stream, which is what lets
            // chat.stop() actually settle chat.status back to "ready" in
            // this test (chat.stop() only aborts a signal — nothing reads
            // it unless the transport's stream honors it).
            init?.signal?.addEventListener("abort", () => {
              firstController.error(
                new DOMException("The operation was aborted.", "AbortError")
              );
            });
            return firstResponse;
          }
          // Follow-up request: plain text reply, no more vector tool calls.
          return sseResponse([
            { type: "start" },
            { type: "start-step" },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "ok" },
            { type: "text-end", id: "t1" },
            { type: "finish-step" },
            { type: "finish" },
          ]);
        }
      );
      vi.stubGlobal("fetch", fetchMock);

      const sessionId = `vector-stop-resurrect-${Date.now()}`;
      const { result } = renderHook(() => useDesignChat({ sessionId }));

      act(() => result.current.setInput("draw a leaf"));
      await act(async () => {
        result.current.sendMessage();
      });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

      // Genuinely stream a partial draw_vector tool call — this creates a
      // real `input-streaming` part in `chat.messages`, unlike the other
      // stop/abort/error tests above which stage drafts synthetically.
      push({ type: "start" });
      push({ type: "start-step" });
      push({ type: "tool-input-start", toolCallId: "vector-stop-1", toolName: "draw_vector" });
      push({
        type: "tool-input-delta",
        toolCallId: "vector-stop-1",
        inputTextDelta: '{"name":"Leaf","commands":"M(10,10)\\n',
      });
      await flushStream();
      push({
        type: "tool-input-delta",
        toolCallId: "vector-stop-1",
        inputTextDelta: 'L(20,20)\\n',
      });
      await flushStream();

      const key = vectorPreviewKey(sessionId, "vector-stop-1");
      await waitFor(() => {
        expect(useAiVectorPreviewStore.getState().drafts[key]).toBeDefined();
      });

      // Stop mid-stream, WITHOUT ever sending tool-input-available. The tool
      // part stays "input-streaming" forever in chat.messages.
      act(() => {
        result.current.stop();
      });

      await waitFor(() => {
        expect(useAiVectorPreviewStore.getState().drafts[key]).toBeUndefined();
      });
      await waitFor(() => expect(result.current.status).toBe("ready"), {
        timeout: 5000,
      });

      // Send a follow-up message — this pushes a new messages array through
      // the hook and re-runs the staging effect over the FULL history,
      // which still contains the stale input-streaming part.
      act(() => result.current.setInput("something else"));
      await act(async () => {
        result.current.sendMessage();
      });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(result.current.status).toBe("ready"));

      // Give the staging effect every chance to re-run and re-upsert.
      await flushStream();

      expect(useAiVectorPreviewStore.getState().drafts[key]).toBeUndefined();
    });

    // Task: prove the generalized streaming-tool registry (src/lib/streamingTools/,
    // src/hooks/streamingToolParts.ts) actually dispatches a streamed frame to
    // its adapter, and that the registered abort controller path (not just
    // `stop()`) permanently blocks a later frame for the same tool call — the
    // same guarantee `abandonedStreamingToolKeysRef` gave `draw_vector` alone
    // before this generalization.
    it("dispatches a streamed frame to its registered adapter, and the abort path permanently blocks a later frame for the same call", async () => {
      const { response: firstResponse, push, controller: firstController } =
        controlledSseResponse();
      const requests: Array<Record<string, unknown>> = [];
      const fetchMock = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          requests.push(JSON.parse(String(init?.body)));
          if (requests.length === 1) {
            init?.signal?.addEventListener("abort", () => {
              firstController.error(
                new DOMException("The operation was aborted.", "AbortError")
              );
            });
            return firstResponse;
          }
          return sseResponse([
            { type: "start" },
            { type: "start-step" },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "ok" },
            { type: "text-end", id: "t1" },
            { type: "finish-step" },
            { type: "finish" },
          ]);
        }
      );
      vi.stubGlobal("fetch", fetchMock);

      const sessionId = `registry-abort-${Date.now()}`;
      const { result: hookResult } = renderHook(() =>
        useDesignChat({ sessionId })
      );

      act(() => hookResult.current.setInput("draw something"));
      await act(async () => {
        hookResult.current.sendMessage();
      });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

      push({ type: "start" });
      push({ type: "start-step" });
      push({
        type: "tool-input-start",
        toolCallId: "registry-1",
        toolName: "draw_vector",
      });
      push({
        type: "tool-input-delta",
        toolCallId: "registry-1",
        inputTextDelta: '{"name":"Leaf","commands":"M(10,10)\\n',
      });
      await flushStream();
      push({
        type: "tool-input-delta",
        toolCallId: "registry-1",
        inputTextDelta: "L(20,20)\\n",
      });
      await flushStream();

      // The frame reached draw_vector's registered adapter: a draft now
      // exists in the preview store, proving the generic dispatch path
      // (extractStreamingToolInputs -> getStreamingToolAdapter -> onFrame)
      // wired the real adapter up correctly.
      const key = vectorPreviewKey(sessionId, "registry-1");
      await waitFor(() => {
        expect(useAiVectorPreviewStore.getState().drafts[key]).toBeDefined();
      });

      // Abort via the registered AbortController (not `stop()`) — this is
      // the path chat.stop()-independent callers (e.g. navigating away) use.
      act(() => {
        useChatStore.getState().abortControllers[sessionId]?.abort();
      });

      await waitFor(() => {
        expect(useAiVectorPreviewStore.getState().drafts[key]).toBeUndefined();
      });
      await waitFor(() => expect(hookResult.current.status).toBe("ready"), {
        timeout: 5000,
      });

      // A follow-up send re-runs the staging effect over the full message
      // history, which still contains the abandoned call's stale
      // input-streaming part. It must not be resurrected.
      act(() => hookResult.current.setInput("something else"));
      await act(async () => {
        hookResult.current.sendMessage();
      });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(hookResult.current.status).toBe("ready"));
      await flushStream();

      expect(useAiVectorPreviewStore.getState().drafts[key]).toBeUndefined();
    });
  });

  // Design-doc test plan item (docs/superpowers/specs/2026-09-13-streaming-tool-mutations-design.md,
  // "Testing"): "a streamed batch_design part mutates the store before the
  // tool call completes, and the completed call leaves one undo entry". This
  // is the end-to-end proof that the generic streaming registry
  // (src/lib/streamingTools/) actually drives the real progressive-mutation
  // path (src/lib/tools/batchDesign/progressive.ts) — not just a synthetic
  // preview store, the way the draw_vector tests above do — through real AI
  // SDK v6 stream chunks.
  describe("streaming batch_design mutations", () => {
    function sseResponse(chunks: Array<Record<string, unknown>>): Response {
      const body =
        chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") +
        "data: [DONE]\n\n";
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-vercel-ai-ui-message-stream": "v1",
        },
      });
    }

    // Same shape as the vector describe block's own helper above — kept
    // local rather than shared, matching that block's existing convention
    // (__tests__ files are exempt from the jscpd duplication gate).
    function controlledSseResponse() {
      let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controllerRef = controller;
        },
      });
      const push = (chunk: Record<string, unknown>) => {
        controllerRef!.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      };
      const close = () => {
        controllerRef!.enqueue(encoder.encode("data: [DONE]\n\n"));
        controllerRef!.close();
      };
      const response = new Response(stream, {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-vercel-ai-ui-message-stream": "v1",
        },
      });
      return { response, push, close, controller: controllerRef! };
    }

    async function flushStream(ms = 20) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
      });
    }

    afterEach(() => {
      // Progressive batch_design sessions live in a module-level Map that
      // outlives resetStores() — the kill switch is the one bit of state
      // that could otherwise leak into a later test in this file.
      try {
        globalThis.localStorage?.removeItem("pen.streamingMutations");
      } catch {
        // ignore
      }
    });

    it("mutates the store before the tool call completes, and the completed call leaves exactly one undo entry", async () => {
      const { response: firstResponse, push, close } = controlledSseResponse();
      const requests: Array<Record<string, unknown>> = [];
      const fetchMock = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          requests.push(JSON.parse(String(init?.body)));
          if (requests.length === 1) {
            return firstResponse;
          }
          return sseResponse([
            { type: "start" },
            { type: "start-step" },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "done" },
            { type: "text-end", id: "t1" },
            { type: "finish-step" },
            { type: "finish" },
          ]);
        }
      );
      vi.stubGlobal("fetch", fetchMock);

      const pastBefore = useHistoryStore.getState().past.length;
      const sessionId = `batch-stream-${Date.now()}`;
      const { result } = renderHook(() => useDesignChat({ sessionId }));

      act(() => result.current.setInput("build a card"));
      await act(async () => {
        result.current.sendMessage();
      });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

      push({ type: "start" });
      push({ type: "start-step" });
      push({
        type: "tool-input-start",
        toolCallId: "batch-1",
        toolName: "batch_design",
      });
      push({
        type: "tool-input-delta",
        toolCallId: "batch-1",
        inputTextDelta:
          '{"operations":"card=I(document, {type: \\"frame\\", name: \\"Card\\", width: 100, height: 100})\\n',
      });
      await flushStream();

      // Mid-stream, well before tool-input-available: the first statement
      // has already landed on the REAL scene, and no undo entry exists yet
      // (streaming never calls saveHistory).
      await waitFor(() => {
        expect(
          Object.values(useSceneStore.getState().nodesById).some(
            (n) => n.name === "Card"
          )
        ).toBe(true);
      });
      expect(useHistoryStore.getState().past.length).toBe(pastBefore);

      push({
        type: "tool-input-delta",
        toolCallId: "batch-1",
        inputTextDelta:
          'card2=I(document, {type: \\"frame\\", name: \\"Card2\\", width: 50, height: 50})\\n',
      });
      await flushStream();

      await waitFor(() => {
        expect(
          Object.values(useSceneStore.getState().nodesById).some(
            (n) => n.name === "Card2"
          )
        ).toBe(true);
      });
      expect(useHistoryStore.getState().past.length).toBe(pastBefore);

      const fullOperations =
        'card=I(document, {type: "frame", name: "Card", width: 100, height: 100})\n' +
        'card2=I(document, {type: "frame", name: "Card2", width: 50, height: 50})\n';

      await act(async () => {
        push({
          type: "tool-input-available",
          toolCallId: "batch-1",
          toolName: "batch_design",
          input: { operations: fullOperations },
        });
        push({ type: "finish-step" });
        push({ type: "finish" });
        close();
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), {
        timeout: 5000,
      });
      await waitFor(() => expect(result.current.status).toBe("ready"), {
        timeout: 5000,
      });

      const cards = Object.values(useSceneStore.getState().nodesById).filter(
        (n) => n.name === "Card"
      );
      const card2s = Object.values(useSceneStore.getState().nodesById).filter(
        (n) => n.name === "Card2"
      );
      expect(cards).toHaveLength(1);
      expect(card2s).toHaveLength(1);
      // The whole batch — streamed part included — is exactly one undo step.
      expect(useHistoryStore.getState().past.length).toBe(pastBefore + 1);
    });
  });

  // HIGH finding regression: a progressive batch_design session must be
  // abandoned (rolled back, no undo entry) even when the turn ends WITHOUT
  // `onToolCall` ever firing for that call — the only two terminal paths
  // that previously cleaned up a streaming session (abort / chat.status ===
  // "error") don't cover either of these. See the "ready" sweep effect in
  // useDesignChat.ts for the full explanation of why chat.status === "ready"
  // is the right (and only) signal for both.
  describe("abandoning a streaming batch_design call that never reaches onToolCall", () => {
    function sseResponse(chunks: Array<Record<string, unknown>>): Response {
      const body =
        chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") +
        "data: [DONE]\n\n";
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-vercel-ai-ui-message-stream": "v1",
        },
      });
    }

    function controlledSseResponse() {
      let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controllerRef = controller;
        },
      });
      const push = (chunk: Record<string, unknown>) => {
        controllerRef!.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      };
      const close = () => {
        controllerRef!.enqueue(encoder.encode("data: [DONE]\n\n"));
        controllerRef!.close();
      };
      const response = new Response(stream, {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-vercel-ai-ui-message-stream": "v1",
        },
      });
      return { response, push, close, controller: controllerRef! };
    }

    async function flushStream(ms = 20) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
      });
    }

    afterEach(() => {
      try {
        globalThis.localStorage?.removeItem("pen.streamingMutations");
      } catch {
        // ignore
      }
    });

    // Path 1: a truncated turn. The provider (one of the models used here
    // fails this way roughly half the time) stops streaming mid-call: no
    // tool-input-available, no tool-input-error, just finish-step/finish.
    // The tool part is stuck at state "input-streaming" forever, so
    // onToolCall never fires and lastAssistantMessageIsCompleteWithToolCalls
    // never lets the SDK auto-continue either — chat.status settles into
    // "ready" for good, with the call abandoned by the provider.
    it("rolls back a batch_design mutation when the turn ends with the tool part still input-streaming", async () => {
      const { response, push, close } = controlledSseResponse();
      const fetchMock = vi.fn(async () => response);
      vi.stubGlobal("fetch", fetchMock);

      const pastBefore = useHistoryStore.getState().past.length;
      const sessionId = `batch-truncated-${Date.now()}`;
      const { result } = renderHook(() => useDesignChat({ sessionId }));

      act(() => result.current.setInput("build a card"));
      await act(async () => {
        result.current.sendMessage();
      });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

      push({ type: "start" });
      push({ type: "start-step" });
      push({
        type: "tool-input-start",
        toolCallId: "batch-trunc-1",
        toolName: "batch_design",
      });
      push({
        type: "tool-input-delta",
        toolCallId: "batch-trunc-1",
        inputTextDelta:
          '{"operations":"card=I(document, {type: \\"frame\\", name: \\"Card\\", width: 100, height: 100})\\n',
      });
      await flushStream();

      await waitFor(() => {
        expect(
          Object.values(useSceneStore.getState().nodesById).some(
            (n) => n.name === "Card"
          )
        ).toBe(true);
      });

      // The provider stops here — the turn ends without ever resolving the
      // tool call.
      await act(async () => {
        push({ type: "finish-step" });
        push({ type: "finish" });
        close();
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      await waitFor(() => expect(result.current.status).toBe("ready"));

      // Never auto-continues: the tool part never resolved to output-available
      // or output-error, so lastAssistantMessageIsCompleteWithToolCalls stays
      // false and the SDK has nothing to send a follow-up request for.
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await waitFor(() => {
        expect(
          Object.values(useSceneStore.getState().nodesById).some(
            (n) => n.name === "Card"
          )
        ).toBe(false);
      });
      expect(useHistoryStore.getState().past.length).toBe(pastBefore);
    });

    // Path 2: a tool-input validation failure (e.g. the backend's zod
    // `.transform()` rejecting the final batch_design args). The SDK's
    // "tool-input-error" chunk flips the part straight to state
    // "output-error" WITHOUT ever invoking onToolCall — that callback is
    // wired only to the sibling "tool-input-available" branch. output-error
    // DOES count as "complete", so the SDK auto-continues with the error as
    // the tool result — but the progressive mutation still needs rolling
    // back, and chat.status still passes through "ready" once, which is what
    // the sweep effect needs.
    it("rolls back a batch_design mutation when the tool call errors out without onToolCall (tool-input-error)", async () => {
      const { response: firstResponse, push, close } = controlledSseResponse();
      const requests: Array<Record<string, unknown>> = [];
      const fetchMock = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          requests.push(JSON.parse(String(init?.body)));
          if (requests.length === 1) {
            return firstResponse;
          }
          return sseResponse([
            { type: "start" },
            { type: "start-step" },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "ok" },
            { type: "text-end", id: "t1" },
            { type: "finish-step" },
            { type: "finish" },
          ]);
        }
      );
      vi.stubGlobal("fetch", fetchMock);

      const pastBefore = useHistoryStore.getState().past.length;
      const sessionId = `batch-input-error-${Date.now()}`;
      const { result } = renderHook(() => useDesignChat({ sessionId }));

      act(() => result.current.setInput("build a card"));
      await act(async () => {
        result.current.sendMessage();
      });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

      push({ type: "start" });
      push({ type: "start-step" });
      push({
        type: "tool-input-start",
        toolCallId: "batch-err-1",
        toolName: "batch_design",
      });
      push({
        type: "tool-input-delta",
        toolCallId: "batch-err-1",
        inputTextDelta:
          '{"operations":"card=I(document, {type: \\"frame\\", name: \\"Card\\", width: 100, height: 100})\\n',
      });
      await flushStream();

      await waitFor(() => {
        expect(
          Object.values(useSceneStore.getState().nodesById).some(
            (n) => n.name === "Card"
          )
        ).toBe(true);
      });

      await act(async () => {
        push({
          type: "tool-input-error",
          toolCallId: "batch-err-1",
          toolName: "batch_design",
          input: { operations: "rejected by the backend's zod .transform()" },
          errorText: "Invalid tool input",
        });
        push({ type: "finish-step" });
        push({ type: "finish" });
        close();
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      await waitFor(() => expect(result.current.status).toBe("ready"));

      await waitFor(() => {
        expect(
          Object.values(useSceneStore.getState().nodesById).some(
            (n) => n.name === "Card"
          )
        ).toBe(false);
      });
      expect(useHistoryStore.getState().past.length).toBe(pastBefore);
    });
  });
});
