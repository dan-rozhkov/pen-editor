import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { toolHandlers, type ToolHandler } from "@/lib/toolRegistry";
import { sse, textTurn } from "@/test/sseStream";
import { useDesignChat } from "../useDesignChat";

const callsTurn = (calls: Array<{ id: string; input: Record<string, unknown> }>) =>
  sse([
    { type: "start" },
    { type: "start-step" },
    ...calls.map((c) => ({ type: "tool-input-available", toolCallId: c.id, toolName: "browse_agent", input: c.input })),
    { type: "finish-step" },
    { type: "finish" },
  ]);

const doneTurn = () => textTurn("ok");

type Run = { id: string; signal?: AbortSignal; finish: (out: string) => void };
let runs: Run[];
let saved: ToolHandler | undefined;
let fetchMock: ReturnType<typeof vi.fn>;

function install(isolated: boolean) {
  const stub = async () => ({});
  window.penDesktop = {
    onMenuCommand: () => () => {},
    browser: { open: stub, act: stub, findImages: stub, read: stub, snapshot: stub, perform: stub, ...(isolated ? { isolated: () => ({}) } : {}) },
  } as never;
}

function stubTurns(first: Response) {
  fetchMock = vi.fn(async () => (fetchMock.mock.calls.length === 1 ? first : doneTurn()));
  vi.stubGlobal("fetch", fetchMock);
}

async function send(result: { current: { setInput: (t: string) => void; sendMessage: () => unknown } }) {
  act(() => result.current.setInput("run the scenarios"));
  await act(async () => {
    result.current.sendMessage();
  });
}

beforeEach(() => {
  runs = [];
  saved = toolHandlers.browse_agent;
  toolHandlers.browse_agent = (_args, ctx) =>
    new Promise<string>((resolve) => {
      runs.push({ id: ctx?.toolCallId ?? "", signal: ctx?.signal, finish: (out) => resolve(out) });
    });
  install(true);
});

afterEach(() => {
  if (saved) toolHandlers.browse_agent = saved;
  delete window.penDesktop;
  vi.unstubAllGlobals();
});

describe("parallel isolated QA browse_agent calls", () => {
  it("starts both calls before either finishes, then continues once after both outputs", async () => {
    stubTurns(callsTurn([{ id: "a", input: { goal: "g1", qa: true } }, { id: "b", input: { goal: "g2", qa: true } }]));
    const { result } = renderHook(() => useDesignChat({ sessionId: "par-session" }));
    await send(result);

    await waitFor(() => expect(runs.map((r) => r.id)).toEqual(["a", "b"]));
    // The stream is done, yet the session still reads as busy.
    expect(result.current.isLoading).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => runs[0].finish('{"status":"done"}'));
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => runs[1].finish('{"status":"done"}'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 3000 });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("starts QA calls that carry a resume checkpoint in parallel too", async () => {
    stubTurns(callsTurn([{ id: "a", input: { goal: "g1", qa: true, resume: "cp_1" } }, { id: "b", input: { goal: "g2", qa: true, resume: "cp_2" } }]));
    const { result } = renderHook(() => useDesignChat({ sessionId: "resume-session" }));
    await send(result);
    await waitFor(() => expect(runs.map((r) => r.id)).toEqual(["a", "b"]));
    await act(async () => runs.forEach((r) => r.finish('{"status":"done"}')));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 3000 });
  });

  it("Stop aborts every running run and does not continue the turn", async () => {
    stubTurns(callsTurn([{ id: "a", input: { goal: "g1", qa: true } }, { id: "b", input: { goal: "g2", qa: true } }]));
    const { result } = renderHook(() => useDesignChat({ sessionId: "stop-session" }));
    await send(result);
    await waitFor(() => expect(runs).toHaveLength(2));

    act(() => result.current.stop());
    expect(runs.map((r) => r.signal?.aborted)).toEqual([true, true]);
    await act(async () => runs.forEach((r) => r.finish('{"status":"aborted"}')));
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["non-QA browse_agent calls", true, false],
    ["QA calls when the shell has no browser.isolated", false, true],
  ])("keeps %s sequential", async (_label, isolated, qa) => {
    install(isolated);
    const input = qa ? { qa: true } : {};
    stubTurns(callsTurn([{ id: "a", input: { goal: "g1", ...input } }, { id: "b", input: { goal: "g2", ...input } }]));
    const { result } = renderHook(() => useDesignChat({ sessionId: "seq-session" }));
    await send(result);
    await waitFor(() => expect(runs.map((r) => r.id)).toEqual(["a"]));
    await new Promise((r) => setTimeout(r, 50));
    expect(runs).toHaveLength(1);
    await act(async () => runs[0].finish("{}"));
    await waitFor(() => expect(runs).toHaveLength(2));
    await act(async () => runs[1].finish("{}"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 3000 });
  });

  it("a send while runs are pending interrupts them and goes out once they are aborted", async () => {
    stubTurns(callsTurn([{ id: "a", input: { goal: "g", qa: true } }]));
    const { result } = renderHook(() => useDesignChat({ sessionId: "busy-session" }));
    await send(result);
    await waitFor(() => expect(runs).toHaveLength(1));
    act(() => result.current.setInput("next"));
    await act(async () => {
      result.current.sendMessage();
    });
    expect(runs[0].signal?.aborted).toBe(true);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 3000 });
    const body = String((fetchMock.mock.calls[1] as unknown as [unknown, RequestInit])[1].body);
    expect(body).toContain("next");
    await act(async () => runs[0].finish('{"status":"aborted"}'));
  });

  it("Stop after an interrupting send still delivers the message once the runs settle", async () => {
    stubTurns(callsTurn([{ id: "a", input: { goal: "g", qa: true } }]));
    const { result } = renderHook(() => useDesignChat({ sessionId: "stopq-session" }));
    await send(result);
    await waitFor(() => expect(runs).toHaveLength(1));
    act(() => result.current.setInput("after stop"));
    await act(async () => {
      result.current.sendMessage();
      result.current.stop();
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 3000 });
    const body = String((fetchMock.mock.calls[1] as unknown as [unknown, RequestInit])[1].body);
    expect(body).toContain("after stop");
    await act(async () => runs[0].finish('{"status":"aborted"}'));
  });

  it("a failed request after an interrupting send keeps the error and does not resend", async () => {
    fetchMock = vi.fn(async () => {
      const n = fetchMock.mock.calls.length;
      if (n === 1) return callsTurn([{ id: "a", input: { goal: "g", qa: true } }]);
      return new Response("boom", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDesignChat({ sessionId: "errq-session" }));
    await send(result);
    await waitFor(() => expect(runs).toHaveLength(1));
    act(() => result.current.setInput("retry me"));
    await act(async () => {
      result.current.sendMessage();
    });
    await waitFor(() => expect(result.current.status).toBe("error"), { timeout: 4000 });
    await new Promise((r) => setTimeout(r, 100));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a provider-executed tool part without output never keeps the chat busy", async () => {
    fetchMock = vi.fn(async () =>
      fetchMock.mock.calls.length === 1
        ? sse([
            { type: "start" },
            { type: "start-step" },
            { type: "tool-input-available", toolCallId: "p1", toolName: "web_search", input: {}, providerExecuted: true },
            { type: "finish-step" },
            { type: "finish" },
          ])
        : doneTurn()
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDesignChat({ sessionId: "prov-session" }));
    await send(result);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.setInput("next"));
    await act(async () => {
      result.current.sendMessage();
    });
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("Clear chat (setMessages([])) aborts live runs", async () => {
    stubTurns(callsTurn([{ id: "a", input: { goal: "g", qa: true } }]));
    const { result } = renderHook(() => useDesignChat({ sessionId: "clear-session" }));
    await send(result);
    await waitFor(() => expect(runs).toHaveLength(1));
    act(() => result.current.setMessages([]));
    expect(runs[0].signal?.aborted).toBe(true);
    await act(async () => runs[0].finish('{"status":"aborted"}'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("Stop answers every live run aborted at once and ends busy before the handlers return", async () => {
    stubTurns(callsTurn([{ id: "a", input: { goal: "g1", qa: true } }, { id: "b", input: { goal: "g2", qa: true } }]));
    const { result } = renderHook(() => useDesignChat({ sessionId: "stopnow-session" }));
    await send(result);
    await waitFor(() => expect(runs).toHaveLength(2));
    act(() => result.current.stop());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const outputs = result.current.messages.flatMap((m) => m.parts).filter((p) => (p as { state?: string }).state === "output-available");
    expect(outputs).toHaveLength(2);
    expect(JSON.stringify(outputs)).toContain("aborted");
    // A late handler result is ignored.
    await act(async () => runs[0].finish('{"status":"done"}'));
    expect(JSON.stringify(result.current.messages)).not.toContain('"status\\":\\"done');
  });

  it("setMessages with an updater that drops the tool call aborts the run", async () => {
    stubTurns(callsTurn([{ id: "a", input: { goal: "g", qa: true } }]));
    const { result } = renderHook(() => useDesignChat({ sessionId: "upd-session" }));
    await send(result);
    await waitFor(() => expect(runs).toHaveLength(1));
    act(() => result.current.setMessages((prev) => prev.slice(0, 1)));
    expect(runs[0].signal?.aborted).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });
});
