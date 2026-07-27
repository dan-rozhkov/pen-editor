import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ShowcasePage } from "@/components/showcase/ShowcasePage";
import { ShowcaseLightbox } from "@/components/showcase/ShowcaseLightbox";
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

    await screen.findByAltText("Onboarding flow");
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

    await screen.findByAltText("Onboarding flow");
    const showMore = screen.getByRole("button", { name: "Show more" });
    fireEvent.click(showMore);

    await screen.findByAltText("Checkout page");
    // Both pages are visible after loading more.
    expect(screen.getByAltText("Onboarding flow")).toBeTruthy();
    // No further cursor — the button disappears.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Show more" })).toBeNull(),
    );
  });

  it("renders screens as bare images — no caption, no click target", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ screens: [screen1()], nextCursor: null })),
    );

    renderPage();

    const image = await screen.findByAltText("Onboarding flow");
    // The metadata that used to sit under each card must not come back as
    // visible text.
    expect(screen.queryByText("test/model")).toBeNull();
    expect(screen.queryByText(/dark/)).toBeNull();
    // The live-HTML lightbox is switched off, so a card is not interactive.
    expect(image.closest("button")).toBeNull();
    expect(image.closest("a")).toBeNull();
  });

  it("uses a white surface, outlined screenshots, and full-width desktop containers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ screens: [screen1()], nextCursor: null })),
    );

    const { container } = renderPage();

    const image = await screen.findByAltText("Onboarding flow");
    const page = container.firstElementChild;
    const header = page?.querySelector("header");
    const main = page?.querySelector("main");
    const card = image.parentElement;

    expect(page?.classList.contains("bg-white")).toBe(true);
    expect(header?.classList.contains("lg:max-w-none")).toBe(true);
    expect(main?.classList.contains("lg:max-w-none")).toBe(true);
    expect(card?.classList.contains("border")).toBe(true);
    expect(card?.classList.contains("border-gray-200")).toBe(true);
  });
});

// ShowcaseLightbox is not rendered by ShowcasePage right now (opening the
// agent's HTML in an iframe is switched off), but the component is kept for
// when it is switched back on — and so is the guard that matters most about
// it. `allow-scripts` together with `allow-same-origin` lifts the sandbox
// entirely, which must never happen for LLM-authored markup.
describe("ShowcaseLightbox", () => {
  it("sandboxes the iframe to allow-scripts, never allow-same-origin", async () => {
    render(
      <ShowcaseLightbox screen={screen1()} onOpenChange={() => {}} />,
    );

    const iframe = await screen.findByTitle("Onboarding flow");
    const sandbox = iframe.getAttribute("sandbox") ?? "";
    expect(sandbox.split(/\s+/)).toContain("allow-scripts");
    expect(sandbox.split(/\s+/)).not.toContain("allow-same-origin");
  });
});
