import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetAuthConfigCache } from "@/lib/auth/authConfig";
import { useAuthStore } from "@/lib/auth/authState";
import { CONFIG_ALL, stubAuthConfig } from "@/test/authMocks";
import { useUserSkillStore } from "@/store/userSkillStore";

import { SkillsSection } from "../SkillsSection";

vi.mock("@/lib/userId", () => ({ getUserId: () => "test-user-id" }));

beforeEach(() => {
  resetAuthConfigCache();
  useAuthStore.setState({ status: "unknown", userId: null });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).endsWith("/api/auth-config")
        ? new Response(JSON.stringify({ enabled: false }), { status: 200 })
        : ({ ok: false, status: 500, json: async () => ({}) } as Response),
    ),
  );
  useUserSkillStore.setState({
    skills: [
      {
        name: "my-skill",
        description: "Handles renaming layers",
        body: "Rename sequentially.",
        enabled: true,
        source: "manual",
        useCount: 0,
        updatedAt: "2026-08-15T00:00:00.000Z",
      },
    ],
    builtIn: [{ name: "prototype", description: "Build a clickable prototype" }],
    available: true,
    status: "ready",
    error: null,
    pendingUpdates: {},
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SkillsSection", () => {
  it("renders the skills list without a chat and without a back button", async () => {
    render(<SkillsSection />);
    await screen.findByTestId("skills-page-add");
    expect(screen.getByRole("heading", { name: "Skills" })).toBeTruthy();
    expect(screen.getByTestId("builtin-skill-prototype")).toBeTruthy();
    expect(screen.getByTestId("user-skill-my-skill")).toBeTruthy();
    // Add is a labelled button in the section's title row, not a row of its own.
    const add = screen.getByTestId("skills-page-add");
    expect(add.textContent).toContain("Add");
    expect(screen.getByRole("heading", { name: "Skills" }).parentElement?.contains(add)).toBe(true);
    expect(screen.queryByTestId("skills-page-back")).toBeNull();
  });

  it("moves focus to the Add skill button when returning to the list", async () => {
    render(<SkillsSection />);
    await screen.findByTestId("skills-page-add");
    fireEvent.click(screen.getByTestId("user-skill-open-my-skill"));
    fireEvent.click(screen.getByTestId("skills-page-back"));
    expect(document.activeElement).toBe(screen.getByTestId("skills-page-add"));
  });

  it("mounts the manager only once the identity is known, and remounts it when it changes", async () => {
    useUserSkillStore.setState({ status: "idle", skills: [], builtIn: [] });
    const skillCalls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.filter((c) => String(c[0]).includes("user-skills"));
    const f = stubAuthConfig(CONFIG_ALL, (url) =>
      url.includes("user-skills") ? new Response(JSON.stringify({ skills: [], available: true }), { status: 200 }) : undefined,
    );
    render(<SkillsSection />);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId("skills-page-add")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Loading");
    expect(skillCalls(f)).toHaveLength(0);

    act(() => useAuthStore.getState().setSession("user-1"));
    await screen.findByTestId("skills-page-add");
    await waitFor(() => expect(useUserSkillStore.getState().status).toBe("ready"));
    const first = skillCalls(f).length;
    expect(first).toBeGreaterThan(0);

    // Remount on identity change: the settled store is a no-op, so no extra fetch
    // (SessionSync owns the refresh).
    fireEvent.click(screen.getByTestId("skills-page-add"));
    act(() => useAuthStore.getState().setSession(null));
    await waitFor(() => expect(screen.getByTestId("skills-page-add")).toBeTruthy()); // back on the list view
    expect(skillCalls(f)).toHaveLength(first);
  });
});
