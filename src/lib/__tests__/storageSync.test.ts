import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { subscribeOpenCodeKey } from "@/lib/opencodeKey";
import { subscribeToMobbinAuthChanges } from "@/lib/mobbinAuth";
import { useMobbinAuthStore } from "@/store/mobbinAuthStore";

import { useChatStore } from "@/store/chatStore";
import { useDevModeStore } from "@/store/devModeStore";
import { useGuidesStore } from "@/store/guidesStore";
import { usePixelGridStore } from "@/store/pixelGridStore";

// `storage` fires only in the OTHER documents, so a dispatched event stands in for the Settings tab.
const fire = (key: string, newValue: string | null) =>
  window.dispatchEvent(new StorageEvent("storage", { key, newValue, storageArea: localStorage }));

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("cross-tab settings sync", () => {
  it("pixel grid follows show-pixel-grid", () => {
    usePixelGridStore.setState({ showPixelGrid: true });
    fire("show-pixel-grid", "false");
    expect(usePixelGridStore.getState().showPixelGrid).toBe(false);
    fire("show-pixel-grid", "true");
    expect(usePixelGridStore.getState().showPixelGrid).toBe(true);
  });

  it("rulers follow show-rulers", () => {
    useGuidesStore.setState({ showRulers: false });
    fire("show-rulers", "true");
    expect(useGuidesStore.getState().showRulers).toBe(true);
  });

  it("a remote chat-model write never changes the model of an existing chat", () => {
    const before = useChatStore.getState();
    const activeBefore = before.chats.find((c) => c.id === before.activeChatId)?.model;
    localStorage.setItem("chat-model", "some/model");
    fire("chat-model", "some/model");
    const s = useChatStore.getState();
    expect(s.model).toBe(before.model);
    expect(s.chats.find((c) => c.id === s.activeChatId)?.model).toBe(activeBefore);
    // ...but it is the default a NEW chat starts on.
    const id = s.createChat({ activate: false });
    expect(useChatStore.getState().chats.find((c) => c.id === id)?.model).toBe("some/model");
  });

  it("the parallel count follows its key, active chat included", () => {
    fire("chat-parallel-count", "3");
    const s = useChatStore.getState();
    expect(s.parallelCount).toBe(3);
    expect(s.chats.find((c) => c.id === s.activeChatId)?.parallelCount).toBe(3);
  });

  it("OpenCode key subscribers run when another document changes the key", () => {
    const cb = vi.fn();
    const off = subscribeOpenCodeKey(cb);
    fire("pen.opencode.key.v1", "sk-x");
    fire("unrelated", "x");
    off();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("Mobbin auth listeners and the store status follow the credential keys", async () => {
    const cb = vi.fn();
    const off = subscribeToMobbinAuthChanges(cb);
    for (const k of ["pen.mobbin.clientId", "pen.mobbin.accessToken", "pen.mobbin.refreshToken", "pen.mobbin.expiresAt"]) {
      fire(k, "v");
    }
    off();
    expect(cb).toHaveBeenCalledTimes(4);

    const refresh = vi.spyOn(useMobbinAuthStore.getState(), "refreshStatus").mockResolvedValue();
    fire("pen.mobbin.accessToken", null);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("dev mode keys re-read from storage", () => {
    localStorage.setItem("dev-mode-units", "rem");
    localStorage.setItem("dev-mode-rem-base", "10");
    fire("dev-mode-units", "rem");
    fire("dev-mode-rem-base", "10");
    expect(useDevModeStore.getState().units).toBe("rem");
    expect(useDevModeStore.getState().remBase).toBe(10);
  });

  it("ignores other keys and other storage areas", () => {
    usePixelGridStore.setState({ showPixelGrid: true });
    fire("unrelated", "false");
    window.dispatchEvent(new StorageEvent("storage", { key: "show-pixel-grid", newValue: "false", storageArea: sessionStorage }));
    expect(usePixelGridStore.getState().showPixelGrid).toBe(true);
  });
});
