import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ShowcasePage } from "@/components/showcase/ShowcasePage";
import type { ShowcaseScreen } from "@/lib/showcase";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function screen1(): ShowcaseScreen {
  return {
    id: "s1",
    runId: "r1",
    theme: "dark",
    title: "Onboarding flow",
    model: "test/model",
    imageUrl: "https://example.com/s1.png",
    htmlUrl: "https://example.com/s1.html",
    width: 390,
    height: 844,
    createdAt: "2026-07-01T00:00:00.000Z",
  };
}

function screen2(): ShowcaseScreen {
  return {
    id: "s2",
    runId: "r2",
    theme: "light",
    title: "Checkout page",
    model: "test/model",
    imageUrl: "https://example.com/s2.png",
    htmlUrl: "https://example.com/s2.html",
    width: 390,
    height: 844,
    createdAt: "2026-07-02T00:00:00.000Z",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ShowcasePage />
    </MemoryRouter>,
  );
}

describe("<ShowcasePage />", () => {
  it("renders the fetched screens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ screens: [screen1()], nextCursor: null })),
    );

    renderPage();

    await screen.findByText("Onboarding flow");
    expect(screen.queryByText("Show more")).toBeNull();
  });

  it("shows an empty-state message when there are no screens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ screens: [], nextCursor: null })),
    );

    renderPage();

    await screen.findByText("Nothing generated yet.");
  });

  it("renders the same empty-state message on a 503 (storage not configured)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: "Showcase storage is not configured" }, 503),
      ),
    );

    renderPage();

    await screen.findByText("Nothing generated yet.");
  });

  it("shows an error message on other failures, without crashing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "limit out of range" }, 400)),
    );

    renderPage();

    await screen.findByText("Couldn't load the showcase.");
    await screen.findByText("limit out of range");
  });

  it("'Show more' loads the next page and appends it to the current list", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("cursor=")) {
        return jsonResponse({ screens: [screen2()], nextCursor: null });
      }
      return jsonResponse({ screens: [screen1()], nextCursor: "cursor-2" });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();

    await screen.findByText("Onboarding flow");
    const showMore = screen.getByRole("button", { name: "Show more" });
    fireEvent.click(showMore);

    await screen.findByText("Checkout page");
    // Both pages are visible after loading more.
    expect(screen.getByText("Onboarding flow")).toBeTruthy();
    // No further cursor — the button disappears.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Show more" })).toBeNull(),
    );
  });

  it("opens a lightbox whose iframe sandbox never includes allow-same-origin", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ screens: [screen1()], nextCursor: null })),
    );

    renderPage();

    const card = await screen.findByText("Onboarding flow");
    fireEvent.click(card.closest("button")!);

    const iframe = await screen.findByTitle("Onboarding flow");
    const sandbox = iframe.getAttribute("sandbox") ?? "";
    expect(sandbox.split(/\s+/)).toContain("allow-scripts");
    expect(sandbox.split(/\s+/)).not.toContain("allow-same-origin");
  });
});
