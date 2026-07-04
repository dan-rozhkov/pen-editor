import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useOnlineStatus", () => {
  it("initializes from navigator.onLine", () => {
    vi.stubGlobal("navigator", { onLine: false });
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(false);
  });

  it("flips to false on an 'offline' event and back to true on 'online'", () => {
    vi.stubGlobal("navigator", { onLine: true });
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current).toBe(false);

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current).toBe(true);
  });

  it("removes its listeners on unmount", () => {
    vi.stubGlobal("navigator", { onLine: true });
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useOnlineStatus());
    unmount();

    const addedEvents = addSpy.mock.calls.map((c) => c[0]);
    const removedEvents = removeSpy.mock.calls.map((c) => c[0]);
    expect(addedEvents).toEqual(expect.arrayContaining(["online", "offline"]));
    expect(removedEvents).toEqual(expect.arrayContaining(["online", "offline"]));
  });
});
