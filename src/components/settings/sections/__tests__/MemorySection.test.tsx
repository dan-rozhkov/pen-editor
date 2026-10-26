import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetAuthConfigCache } from "@/lib/auth/authConfig";
import { useAuthStore } from "@/lib/auth/authState";
import { CONFIG_ALL, stubAuthConfig } from "@/test/authMocks";

import { MemorySection } from "../MemorySection";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const base = { available: true, enabled: true, memory: ["Uses Figma"], user: ["Likes dark mode"], limits: { memory: 2000, user: 1000 } };

function stub(handler: (url: string, init?: RequestInit) => Response) {
  const f = vi.fn(async (url: string, init?: RequestInit) =>
    String(url).endsWith("/api/auth-config") ? json({ enabled: false }) : handler(String(url), init),
  );
  vi.stubGlobal("fetch", f);
  return f;
}

beforeEach(() => {
  resetAuthConfigCache();
  useAuthStore.setState({ status: "unknown", userId: null });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MemorySection", () => {
  it("lists entries and removes one optimistically", async () => {
    const f = stub((_url, init) => (init?.method === "DELETE" ? json({ removed: true }) : json(base)));
    render(<MemorySection />);
    await screen.findByText("Likes dark mode");
    fireEvent.click(screen.getByRole("button", { name: /Delete memory: Likes dark mode/ }));
    await waitFor(() => expect(screen.queryByText("Likes dark mode")).toBeNull());
    const call = f.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "DELETE")!;
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ target: "user", text: "Likes dark mode" });
  });

  it("restores the entry when the delete fails", async () => {
    stub((_url, init) => (init?.method === "DELETE" ? json({ error: "x" }, 500) : json(base)));
    render(<MemorySection />);
    await screen.findByText("Uses Figma");
    fireEvent.click(screen.getByRole("button", { name: /Delete memory: Uses Figma/ }));
    await screen.findByText("Could not delete that entry.");
    expect(screen.getByText("Uses Figma")).toBeTruthy();
  });

  it("confirms in the page before clearing all", async () => {
    const f = stub((_url, init) => (init?.method === "DELETE" ? json({ cleared: { memory: 1, user: 1 } }) : json(base)));
    render(<MemorySection />);
    await screen.findByText("Uses Figma");
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(f.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "DELETE")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Delete all" }));
    await screen.findByText("The agent has not saved anything yet.");
  });

  it("reverts the switch when saving fails", async () => {
    stub((_url, init) => (init?.method === "PUT" ? json({}, 500) : json(base)));
    render(<MemorySection />);
    const sw = await screen.findByRole("switch", { name: "Agent remembers" });
    fireEvent.click(sw);
    await screen.findByText("Could not change this setting.");
    expect(screen.getByRole("switch", { name: "Agent remembers" }).getAttribute("aria-checked")).toBe("true");
  });

  it("shows empty, unavailable and error states", async () => {
    stub(() => json({ ...base, memory: [], user: [] }));
    const { unmount } = render(<MemorySection />);
    await screen.findByText("The agent has not saved anything yet.");
    unmount();

    stub(() => json({ ...base, available: false }));
    const second = render(<MemorySection />);
    await screen.findByText("Memory is turned off on this server.");
    expect(screen.queryByRole("switch")).toBeNull();
    second.unmount();

    let fail = true;
    stub(() => (fail ? json({}, 500) : json(base)));
    render(<MemorySection />);
    await screen.findByText(/Could not load/);
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Uses Figma");
  });

  it("waits for the session, then fetches per identity and again when it changes", async () => {
    const memoryCalls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.filter((c) => String(c[0]).includes("/api/memory"));
    const f = stubAuthConfig(CONFIG_ALL, (url) => (url.includes("/api/memory") ? json(base) : undefined));
    render(<MemorySection />);
    await new Promise((r) => setTimeout(r, 30));
    expect(memoryCalls(f)).toHaveLength(0);
    expect(screen.getByRole("status").textContent).toContain("Loading");

    act(() => useAuthStore.getState().setSession("user-1"));
    await screen.findByText("Uses Figma");
    expect(memoryCalls(f)).toHaveLength(1);
    expect(String(memoryCalls(f)[0][0])).not.toContain("userId=");

    act(() => useAuthStore.getState().setSession(null));
    await waitFor(() => expect(memoryCalls(f)).toHaveLength(2));
  });

  it("disables the switch while saving and rolls back to the value before the click", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/auth-config")) return json({ enabled: false });
      if (init?.method === "PUT") {
        await gate;
        return json({}, 500);
      }
      return json({ ...base, enabled: false });
    });
    vi.stubGlobal("fetch", f);
    render(<MemorySection />);
    const sw = await screen.findByRole("switch", { name: "Agent remembers" });
    fireEvent.click(sw);
    await waitFor(() => expect(screen.getByRole("switch", { name: "Agent remembers" }).hasAttribute("data-disabled")).toBe(true));
    fireEvent.click(screen.getByRole("switch", { name: "Agent remembers" }));
    expect(f.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "PUT")).toHaveLength(1);
    release();
    await screen.findByText("Could not change this setting.");
    const after = screen.getByRole("switch", { name: "Agent remembers" });
    expect(after.getAttribute("aria-checked")).toBe("false");
    expect(after.hasAttribute("data-disabled")).toBe(false);
  });

  it("removes only the clicked copy of a duplicate entry and restores it at its index on failure", async () => {
    const dup = { ...base, user: ["same", "other", "same"], memory: [] };
    let fail = false;
    const f = stub((_url, init) => (init?.method === "DELETE" ? json(fail ? { error: "x" } : { removed: true }, fail ? 500 : 200) : json(dup)));
    render(<MemorySection />);
    await screen.findByText("other");
    expect(screen.getAllByText("same")).toHaveLength(2);

    fireEvent.click(screen.getAllByRole("button", { name: /Delete memory: same/ })[1]);
    await waitFor(() => expect(screen.getAllByText("same")).toHaveLength(1));
    expect(f.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "DELETE")).toHaveLength(1);

    fail = true;
    fireEvent.click(screen.getAllByRole("button", { name: /Delete memory: same/ })[0]);
    await screen.findByText("Could not delete that entry.");
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items[0]).toBe("same");
    expect(items[1]).toBe("other");
  });

  it("locks every write control while one write is in flight and does not resurrect text after Clear all", async () => {
    let releaseDelete!: () => void;
    const gate = new Promise<void>((r) => (releaseDelete = r));
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/auth-config")) return json({ enabled: false });
      if (init?.method === "DELETE") {
        await gate;
        return json({ error: "x" }, 500);
      }
      return json(base);
    });
    vi.stubGlobal("fetch", f);
    render(<MemorySection />);
    await screen.findByText("Uses Figma");
    const deletes = () => f.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "DELETE");

    fireEvent.click(screen.getByRole("button", { name: /Delete memory: Uses Figma/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Clear all" }).hasAttribute("disabled")).toBe(true));
    expect(screen.getByRole("switch", { name: "Agent remembers" }).hasAttribute("data-disabled")).toBe(true);
    expect((screen.getByRole("button", { name: /Delete memory: Likes dark mode/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    fireEvent.click(screen.getByRole("button", { name: /Delete memory: Likes dark mode/ }));
    expect(deletes()).toHaveLength(1);

    releaseDelete();
    await screen.findByText("Could not delete that entry.");
    expect(screen.getByText("Uses Figma")).toBeTruthy(); // restored by the failed delete, no Clear all raced it
    expect((screen.getByRole("button", { name: "Clear all" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("renders the section shell once while the identity loads", async () => {
    stubAuthConfig(CONFIG_ALL, () => undefined);
    render(<MemorySection />);
    expect(screen.getAllByText("The agent remembers facts about you and your work across chats.")).toHaveLength(1);
    expect(screen.getAllByRole("heading", { name: "Agent memory" })).toHaveLength(1);
    act(() => useAuthStore.getState().setSession(null));
  });
});
