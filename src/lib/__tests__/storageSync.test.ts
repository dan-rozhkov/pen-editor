import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { subscribeOpenCodeKey } from "@/lib/opencodeKey";
import { createStorageFlag } from "@/lib/storageSync";
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

describe("createStorageFlag", () => {
  it("onValue marker: absent = off, marker = on, set(false) removes the key", () => {
    const flag = createStorageFlag("t.on", { onValue: "all" });
    expect(flag.get()).toBe(false);
    flag.set(true);
    expect(localStorage.getItem("t.on")).toBe("all");
    expect(flag.get()).toBe(true);
    flag.set(false);
    expect(localStorage.getItem("t.on")).toBeNull();
    expect(flag.get()).toBe(false);
  });

  it("offValue marker: absent = on, marker = off, set(true) removes the key", () => {
    const flag = createStorageFlag("t.off", { offValue: "off" });
    expect(flag.get()).toBe(true);
    flag.set(false);
    expect(localStorage.getItem("t.off")).toBe("off");
    expect(flag.get()).toBe(false);
    flag.set(true);
    expect(localStorage.getItem("t.off")).toBeNull();
    expect(flag.get()).toBe(true);
  });

  it("notifies on a local set and on another document's write to its key only; unsubscribe stops it", () => {
    const flag = createStorageFlag("t.sub", { onValue: "all" });
    const cb = vi.fn();
    const off = flag.subscribe(cb);
    flag.set(true);
    expect(cb).toHaveBeenCalledTimes(1);
    fire("t.sub", null);
    expect(cb).toHaveBeenCalledTimes(2);
    fire("other", "x");
    expect(cb).toHaveBeenCalledTimes(2);
    off();
    flag.set(false);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("falls back to the absent state when storage throws", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(createStorageFlag("t.x", { onValue: "all" }).get()).toBe(false);
    expect(createStorageFlag("t.y", { offValue: "off" }).get()).toBe(true);
    spy.mockRestore();
  });
});
