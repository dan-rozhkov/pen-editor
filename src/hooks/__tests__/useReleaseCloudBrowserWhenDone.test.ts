import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  RELEASE_GRACE_MS,
  useReleaseCloudBrowserWhenDone,
} from "@/hooks/useReleaseCloudBrowserWhenDone";
import { useCloudBrowserStore } from "@/store/cloudBrowserStore";

const release = vi.fn(async (_chatId: string) => true);
vi.mock("@/lib/cloudBrowser", () => ({
  releaseCloudBrowser: (id: string) => release(id),
}));

const SESSION = { liveViewUrl: "https://live.example/v/1", expiresAt: null };
const BUSY = { isBusy: true, awaitingAnswer: false, hasQueuedMessages: false };
const IDLE = { isBusy: false, awaitingAnswer: false, hasQueuedMessages: false };

function setup(initial = BUSY) {
  return renderHook(
    (state: typeof BUSY) => useReleaseCloudBrowserWhenDone({ chatId: "chat-1", ...state }),
    { initialProps: initial },
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  release.mockClear();
  useCloudBrowserStore.setState({ sessions: { "chat-1": SESSION } });
});

afterEach(() => {
  vi.useRealTimers();
  delete window.penDesktop;
});

describe("useReleaseCloudBrowserWhenDone", () => {
  it("releases after the turn ends and the grace delay passes", () => {
    const { rerender } = setup();
    rerender(IDLE);
    act(() => void vi.advanceTimersByTime(RELEASE_GRACE_MS - 1));
    expect(release).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(2));
    expect(release).toHaveBeenCalledExactlyOnceWith("chat-1");
  });

  it("does not release on a transient ready that turns busy again within grace", () => {
    const { rerender } = setup();
    rerender(IDLE);
    act(() => void vi.advanceTimersByTime(RELEASE_GRACE_MS / 2));
    rerender(BUSY);
    act(() => void vi.advanceTimersByTime(RELEASE_GRACE_MS * 2));
    expect(release).not.toHaveBeenCalled();
  });

  it("does not release while awaiting an ask_user answer", () => {
    const { rerender } = setup();
    rerender({ ...IDLE, awaitingAnswer: true });
    act(() => void vi.advanceTimersByTime(RELEASE_GRACE_MS * 5));
    expect(release).not.toHaveBeenCalled();
  });

  it("does not release while messages are queued", () => {
    const { rerender } = setup();
    rerender({ ...IDLE, hasQueuedMessages: true });
    act(() => void vi.advanceTimersByTime(RELEASE_GRACE_MS * 5));
    expect(release).not.toHaveBeenCalled();
  });

  it("releases once the user answers and the turn then finishes", () => {
    const { rerender } = setup();
    rerender({ ...IDLE, awaitingAnswer: true });
    rerender(BUSY);
    rerender(IDLE);
    act(() => void vi.advanceTimersByTime(RELEASE_GRACE_MS + 1));
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the chat has no session", () => {
    useCloudBrowserStore.setState({ sessions: {} });
    const { rerender } = setup();
    rerender(IDLE);
    act(() => void vi.advanceTimersByTime(RELEASE_GRACE_MS + 1));
    expect(release).not.toHaveBeenCalled();
  });

  it("does not release a chat that never worked", () => {
    setup(IDLE);
    act(() => void vi.advanceTimersByTime(RELEASE_GRACE_MS * 2));
    expect(release).not.toHaveBeenCalled();
  });

  it("ignores the desktop shell", () => {
    window.penDesktop = { onMenuCommand: () => () => {}, browser: {} } as never;
    const { rerender } = setup();
    rerender(IDLE);
    act(() => void vi.advanceTimersByTime(RELEASE_GRACE_MS + 1));
    expect(release).not.toHaveBeenCalled();
  });
});
