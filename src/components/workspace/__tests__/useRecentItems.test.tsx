import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ list: vi.fn(), listeners: [] as Array<() => void> }));

vi.mock("@/lib/canvases/webCanvasStore", () => ({
  webCanvasStore: { list: mocks.list, remove: vi.fn() },
  subscribeWebCanvases: (cb: () => void) => {
    mocks.listeners.push(cb);
    return () => {};
  },
}));
vi.mock("@/lib/docs/docStore", () => ({ listDocs: () => [], deleteDoc: vi.fn(), subscribeDocs: () => () => {} }));
vi.mock("@/lib/workflows/workflowStore", () => ({ listWorkflows: () => [], deleteWorkflow: vi.fn(), subscribeWorkflows: () => () => {} }));

import { useRecentItems } from "../useRecentItems";

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  mocks.listeners.length = 0;
});

describe("useRecentItems", () => {
  it("reloads once for a burst of store events and not after unmount", async () => {
    vi.useFakeTimers();
    mocks.list.mockResolvedValue({ canvases: [] });
    const { unmount } = renderHook(() => useRecentItems());
    await act(async () => {});
    expect(mocks.list).toHaveBeenCalledTimes(1);
    act(() => {
      for (let i = 0; i < 5; i++) mocks.listeners.forEach((cb) => cb());
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(mocks.list).toHaveBeenCalledTimes(2);
    act(() => mocks.listeners.forEach((cb) => cb()));
    unmount();
    await vi.advanceTimersByTimeAsync(200);
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });
});
