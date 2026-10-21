import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginMenu, type LoginMenuHandle } from "../LoginMenu";

const list = vi.fn();
const key = (name: string) => ({ event: new KeyboardEvent("keydown", { key: name }), view: undefined as never, range: undefined as never });

beforeEach(() => {
  window.penDesktop = { logins: { list, add: vi.fn() } } as never;
});
afterEach(() => {
  cleanup();
  window.penDesktop = undefined;
});

function mount(query: string) {
  const ref = createRef<LoginMenuHandle>();
  const command = vi.fn();
  render(<LoginMenu ref={ref} query={query} command={command} />);
  return { ref, command };
}

describe("LoginMenu keys", () => {
  it("leaves Enter and Tab to the editor with an empty query and no logins", async () => {
    list.mockResolvedValue({ entries: [], encryptionAvailable: true });
    const { ref, command } = mount("");
    await screen.findByText("Create new login");
    expect(ref.current!.onKeyDown(key("Enter"))).toBe(false);
    expect(ref.current!.onKeyDown(key("Tab"))).toBe(false);
    expect(command).not.toHaveBeenCalled();
    // Nothing to choose: the caret keys move the caret too.
    expect(ref.current!.onKeyDown(key("ArrowDown"))).toBe(false);
    expect(ref.current!.onKeyDown(key("ArrowUp"))).toBe(false);
  });

  it("does not pick Create while the list is still loading, even with a query", async () => {
    let resolve: (value: unknown) => void = () => {};
    list.mockReturnValue(new Promise((r) => (resolve = r)));
    const { ref, command } = mount("zed");
    expect(ref.current!.onKeyDown(key("Enter"))).toBe(false);
    expect(ref.current!.onKeyDown(key("ArrowDown"))).toBe(false);
    expect(command).not.toHaveBeenCalled();
    await act(async () => resolve({ entries: [], encryptionAvailable: true }));
    await screen.findByText("Create login “zed”");
    act(() => void ref.current!.onKeyDown(key("Enter")));
    expect(command).toHaveBeenCalledWith({ kind: "create", query: "zed" });
  });

  it("leaves Enter to the editor while loading and on error", async () => {
    list.mockResolvedValue({ ok: false, error: "Locked" });
    const { ref } = mount("");
    expect(ref.current!.onKeyDown(key("Enter"))).toBe(false);
    await screen.findByText("Locked");
    expect(ref.current!.onKeyDown(key("Enter"))).toBe(false);
  });

  it("picks the highlighted login on Enter", async () => {
    const entry = { id: "1", origin: "https://a.test", username: "alice", label: "" };
    list.mockResolvedValue({ entries: [entry], encryptionAvailable: true });
    const { ref, command } = mount("");
    await waitFor(() => expect(screen.getByText("alice")).toBeTruthy());
    act(() => void ref.current!.onKeyDown(key("Enter")));
    expect(command).toHaveBeenCalledWith({ kind: "login", login: entry });
  });

  it("picks the create row on Enter when a query matches nothing", async () => {
    list.mockResolvedValue({ entries: [], encryptionAvailable: true });
    const { ref, command } = mount("zed");
    await screen.findByText("Create login “zed”");
    act(() => void ref.current!.onKeyDown(key("Enter")));
    expect(command).toHaveBeenCalledWith({ kind: "create", query: "zed" });
  });
});
