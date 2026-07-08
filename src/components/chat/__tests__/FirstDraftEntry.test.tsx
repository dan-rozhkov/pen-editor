import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { FirstDraftEntry } from "@/components/chat/FirstDraftEntry";
import { useChatStore } from "@/store/chatStore";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";

afterEach(() => cleanup());

beforeEach(() => {
  useChatStore.setState({
    tabs: [{ id: "tab-0", title: "Chat 1", model: "m", agentMode: "prototype", parallelCount: 1 }],
    activeTabId: "tab-0",
    launchQueue: {},
  });
  useLeftSidebarStore.setState({ activeSection: "pages", isPanelOpen: false });
});

describe("<FirstDraftEntry />", () => {
  it("defaults to mobile platform and a disabled submit button when empty", () => {
    render(<FirstDraftEntry />);
    expect(screen.getByRole("button", { name: /mobile/i }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /desktop/i }).getAttribute("aria-pressed")).toBe("false");
    expect(
      (screen.getByRole("button", { name: /generate first draft/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("dispatches a /first-draft chat with the typed description and selected platform", () => {
    render(<FirstDraftEntry />);

    fireEvent.change(screen.getByPlaceholderText(/describe the screen/i), {
      target: { value: "a pricing page with three tiers" },
    });
    fireEvent.click(screen.getByRole("button", { name: /desktop/i }));
    fireEvent.click(screen.getByRole("button", { name: /generate first draft/i }));

    const { tabs, activeTabId, launchQueue } = useChatStore.getState();
    expect(tabs.length).toBe(2);
    const text = launchQueue[activeTabId]?.text ?? "";
    expect(text).toMatch(/^\/first-draft\b/);
    expect(text).toContain("a pricing page with three tiers");
    expect(text.toLowerCase()).toContain("desktop");
    expect(useLeftSidebarStore.getState().activeSection).toBe("agents");
  });

  it("keeps the submit button disabled for whitespace-only input", () => {
    render(<FirstDraftEntry />);
    fireEvent.change(screen.getByPlaceholderText(/describe the screen/i), {
      target: { value: "   " },
    });
    expect(
      (screen.getByRole("button", { name: /generate first draft/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
