import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { UIMessage } from "ai";
import { usePromptSuggestion } from "../usePromptSuggestion";

let resolveFetch: (v: string | null) => void = () => {};
let lastSignal: AbortSignal | undefined;
const fetchSuggestion = vi.fn((_m: unknown, signal?: AbortSignal) => {
  lastSignal = signal;
  return new Promise<string | null>((r) => (resolveFetch = r));
});
vi.mock("@/lib/promptSuggestion", async (orig) => ({
  ...(await orig<typeof import("@/lib/promptSuggestion")>()),
  fetchPromptSuggestion: (m: unknown, s?: AbortSignal) => fetchSuggestion(m, s),
}));

const messages = [
  { id: "1", role: "user", parts: [{ type: "text", text: "hi" }] },
  { id: "2", role: "assistant", parts: [{ type: "text", text: "done" }] },
] as UIMessage[];

type Props = Parameters<typeof usePromptSuggestion>[0];
const base: Props = { sessionId: "s", status: "ready", messages, input: "", awaitingAnswer: false };
const setup = (initial: Partial<Props> = {}) =>
  renderHook((p: Props) => usePromptSuggestion(p), { initialProps: { ...base, ...initial } });

beforeEach(() => {
  fetchSuggestion.mockClear();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());
const settle = () => act(() => void vi.advanceTimersByTime(700));

describe("usePromptSuggestion", () => {
  it("does not fetch on mount", () => {
    setup();
    expect(fetchSuggestion).not.toHaveBeenCalled();
  });

  it("fetches on streaming -> ready and exposes the result", async () => {
    const { result, rerender } = setup({ status: "streaming" });
    rerender({ ...base, status: "ready" });
    expect(fetchSuggestion).not.toHaveBeenCalled();
    settle();
    expect(fetchSuggestion).toHaveBeenCalledTimes(1);
    await act(async () => resolveFetch("make the header bigger"));
    await vi.waitFor(() => expect(result.current.suggestion).toBe("make the header bigger"));
    act(() => result.current.dismiss());
    expect(result.current.suggestion).toBeNull();
  });

  it("does not fetch after an error, with a pending ask_user, or with text in the input", () => {
    const a = setup({ status: "error" });
    a.rerender({ ...base, status: "ready" });
    const b = setup({ status: "streaming", awaitingAnswer: true });
    b.rerender({ ...base, status: "ready", awaitingAnswer: true });
    const c = setup({ status: "streaming", input: "typing" });
    c.rerender({ ...base, status: "ready", input: "typing" });
    settle();
    expect(fetchSuggestion).not.toHaveBeenCalled();
  });

  it("does not fetch when the last message is the user's", () => {
    const { rerender } = setup({ status: "streaming", messages: messages.slice(0, 1) });
    rerender({ ...base, status: "ready", messages: messages.slice(0, 1) });
    settle();
    expect(fetchSuggestion).not.toHaveBeenCalled();
  });

  it("aborts and clears when a new turn starts", async () => {
    const { result, rerender } = setup({ status: "streaming" });
    rerender({ ...base, status: "ready" });
    settle();
    await act(async () => resolveFetch("next"));
    await vi.waitFor(() => expect(result.current.suggestion).toBe("next"));
    const signal = lastSignal!;
    rerender({ ...base, status: "submitted" });
    expect(signal.aborted).toBe(true);
    expect(result.current.suggestion).toBeNull();
  });

  it("aborts an in-flight request on unmount", () => {
    const { rerender, unmount } = setup({ status: "streaming" });
    rerender({ ...base, status: "ready" });
    settle();
    unmount();
    expect(lastSignal!.aborted).toBe(true);
  });

  it("ignores a result that arrives after the input became non-empty", async () => {
    const { result, rerender } = setup({ status: "streaming" });
    rerender({ ...base, status: "ready" });
    settle();
    rerender({ ...base, status: "ready", input: "x" });
    await act(async () => resolveFetch("late"));
    expect(result.current.suggestion).toBeNull();
  });

  it("hides the suggestion once the last message id changes (clear / rollback)", async () => {
    const { result, rerender } = setup({ status: "streaming" });
    rerender({ ...base, status: "ready" });
    settle();
    await act(async () => resolveFetch("next"));
    await vi.waitFor(() => expect(result.current.suggestion).toBe("next"));
    rerender({ ...base, status: "ready", messages: [] });
    expect(result.current.suggestion).toBeNull();
    rerender({ ...base, status: "ready", messages: messages.slice(0, 1) });
    expect(result.current.suggestion).toBeNull();
  });

  it("debounces: a quick ready -> submitted never fetches", () => {
    const { rerender } = setup({ status: "streaming" });
    rerender({ ...base, status: "ready" });
    act(() => void vi.advanceTimersByTime(300));
    rerender({ ...base, status: "submitted" });
    settle();
    expect(fetchSuggestion).not.toHaveBeenCalled();
  });

  it("skips while the last assistant message has an unfinished tool part", () => {
    const pending = [
      messages[0],
      {
        id: "2",
        role: "assistant",
        parts: [
          { type: "text", text: "working" },
          { type: "tool-batch_design", state: "input-available" },
        ],
      },
    ] as unknown as UIMessage[];
    const { rerender } = setup({ status: "streaming", messages: pending });
    rerender({ ...base, status: "ready", messages: pending });
    settle();
    expect(fetchSuggestion).not.toHaveBeenCalled();
  });

  it("skips when the final assistant turn has no text", () => {
    const toolOnly = [
      messages[0],
      { id: "2", role: "assistant", parts: [{ type: "tool-x", state: "output-available" }] },
    ] as unknown as UIMessage[];
    const { rerender } = setup({ status: "streaming", messages: toolOnly });
    rerender({ ...base, status: "ready", messages: toolOnly });
    settle();
    expect(fetchSuggestion).not.toHaveBeenCalled();
  });

  it("does nothing when disabled", () => {
    const { rerender } = setup({ status: "streaming", enabled: false });
    rerender({ ...base, status: "ready", enabled: false });
    settle();
    expect(fetchSuggestion).not.toHaveBeenCalled();
  });
});
