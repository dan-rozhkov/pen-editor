import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { ShowcasePage } from "@/components/showcase/ShowcasePage";
import { ShowcaseLightbox } from "@/components/showcase/ShowcaseLightbox";
import { consumeShowcaseAgentPrompt } from "@/lib/showcaseAgentHandoff";
import type { ShowcaseApp, ShowcaseCategory, ShowcaseScreen } from "@/lib/showcase";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function screen1(): ShowcaseScreen {
  return {
    id: "s1",
    title: "Onboarding flow",
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
    title: "Checkout page",
    imageUrl: "https://example.com/s2.png",
    htmlUrl: "https://example.com/s2.html",
    width: 390,
    height: 844,
    createdAt: "2026-07-02T00:00:00.000Z",
  };
}

function screen3(): ShowcaseScreen {
  return {
    ...screen1(),
    id: "s3",
    title: "Onboarding details",
    imageUrl: "https://example.com/s3.png",
  };
}

// The feed hands back whole apps, so fixtures are apps too — there is no
// client-side grouping left to exercise.
function app(
  runId: string,
  screens: ShowcaseScreen[],
  likes = 0,
  platform: ShowcaseApp["platform"] = "mobile",
): ShowcaseApp {
  return {
    runId,
    theme: "dark",
    model: "test/model",
    createdAt: screens[0].createdAt,
    likes,
    platform,
    screens,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// The page always fetches /api/showcase/categories alongside the feed now;
// tests that only care about the feed response route this to an empty list
// so the mock doesn't need a per-test branch for it.
function withCategories(
  handler: (input: RequestInfo | URL) => Promise<Response> | Response,
) {
  return vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/api/showcase/categories")) {
      return jsonResponse({ categories: [] });
    }
    return handler(input);
  });
}

function installIntersectionObserver() {
  let callback: IntersectionObserverCallback | null = null;
  let target: Element | null = null;

  class MockIntersectionObserver {
    readonly root = null;
    readonly rootMargin = "600px 0px";
    readonly thresholds = [0];

    constructor(nextCallback: IntersectionObserverCallback) {
      callback = nextCallback;
    }

    observe(element: Element) {
      target = element;
    }

    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }

  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

  return {
    intersect() {
      if (!callback || !target) {
        throw new Error("IntersectionObserver is not observing the load-more sentinel");
      }
      callback(
        [{ isIntersecting: true, target } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    },
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ShowcasePage />
    </MemoryRouter>,
  );
}

function renderNavigablePage() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<ShowcasePage />} />
        <Route path="/app" element={<div>Editor route</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

// Renders the visible location.search alongside the page (as a `data-search`
// attribute) so tests can assert on the URL that clicking a tab/chip
// produces, without reaching into MemoryRouter internals.
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-search" data-search={location.search} />;
}

function renderPageAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <ShowcasePage />
    </MemoryRouter>,
  );
}

function currentSearch() {
  return screen.getByTestId("location-search").getAttribute("data-search");
}

function categoriesResponse(categories: ShowcaseCategory[]): Response {
  return jsonResponse({ categories });
}

describe("<ShowcasePage />", () => {
  it("presents the design agent as the primary showcase action", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));

    renderPage();

    const heading = screen.getByRole("heading", {
      name: "Design, on autopilot.",
    });
    const editorButton = screen.getByRole("button", {
      name: "Open the editor →",
    });

    expect(heading).toBeTruthy();
    expect(
      heading.classList.contains("sm:text-[clamp(3.375rem,6vw,4.875rem)]"),
    ).toBe(true);
    expect(heading.classList.contains("tracking-tight")).toBe(true);
    expect(
      screen.getByPlaceholderText("Ask the design agent to create…"),
    ).toBeTruthy();
    expect(editorButton.parentElement?.tagName).toBe("HEADER");
    expect(editorButton.classList.contains("bg-accent-primary/10")).toBe(true);
    expect(editorButton.classList.contains("absolute")).toBe(true);
    expect(
      editorButton.classList.contains("right-[calc(1rem+env(safe-area-inset-right))]"),
    ).toBe(true);
  });

  it("stores a trimmed prompt and navigates to the editor", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    sessionStorage.clear();
    renderNavigablePage();

    const input = screen.getByPlaceholderText("Ask the design agent to create…");
    fireEvent.change(input, {
      target: { value: "  Build a calm finance dashboard  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await screen.findByText("Editor route");
    expect(consumeShowcaseAgentPrompt()).toBe("Build a calm finance dashboard");
  });

  it("opens the editor from the header button", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    renderNavigablePage();

    fireEvent.click(screen.getByRole("button", { name: "Open the editor →" }));

    await screen.findByText("Editor route");
  });

  it("renders one carousel per app, with all of its screens", async () => {
    vi.stubGlobal(
      "fetch",
      withCategories(async () =>
        jsonResponse({
          apps: [app("r1", [screen1(), screen3()]), app("r2", [screen2()])],
          nextCursor: null,
        }),
      ),
    );

    renderPage();

    await screen.findByAltText("Onboarding flow");
    const carousels = screen.getAllByRole("region");
    const selector = screen.getByLabelText("Screen selector");
    expect(carousels).toHaveLength(2);
    expect(carousels[0].getAttribute("data-slot")).toBe("showcase-app-carousel");
    expect(carousels[0].classList.contains("overflow-hidden")).toBe(true);
    // `role="region"` is on the panel, not on the scroller — an explicit role
    // on the <ol> would strip its `list` role and orphan the <li>s. The
    // scroller is the panel's list child and carries the native scroll-snap
    // classes (no more Embla `data-transition`/slide opacity plumbing).
    const scroller = screen.getAllByRole("list")[0];
    expect(scroller.tagName).toBe("OL");
    expect(scroller.classList.contains("snap-mandatory")).toBe(true);
    expect(scroller.classList.contains("overflow-y-hidden")).toBe(true);
    expect(
      screen.getByAltText("Onboarding flow").closest("li")?.classList.contains("snap-center"),
    ).toBe(true);
    const nextScreen = screen.getByRole("button", { name: "Next screen" });
    expect(nextScreen.classList.contains("size-10")).toBe(true);
    expect(nextScreen.classList.contains("bg-surface-active/80")).toBe(true);
    expect(nextScreen.classList.contains("backdrop-blur-sm")).toBe(true);
    // Inside the panel, not hanging off it: the panel's horizontal padding
    // moved onto the scroller (it is what produces the peek), so a negative
    // offset would put the arrow outside the panel's `overflow-hidden` box.
    expect(nextScreen.classList.contains("right-1")).toBe(true);
    expect(nextScreen.classList.contains("sm:right-3")).toBe(true);
    expect(nextScreen.classList.contains("text-text-primary")).toBe(true);
    expect(selector.classList.contains("absolute")).toBe(true);
    expect(selector.classList.contains("top-5")).toBe(true);
    expect(selector.classList.contains("right-5")).toBe(true);
    expect(selector.classList.contains("opacity-0")).toBe(false);
    const [modelBadge] = screen.getAllByText("Model");
    expect(modelBadge.classList.contains("block")).toBe(true);
    expect(modelBadge.classList.contains("truncate")).toBe(true);
    expect(modelBadge.classList.contains("text-center")).toBe(true);
    expect(modelBadge.classList.contains("font-normal")).toBe(true);
    expect(modelBadge.classList.contains("text-text-muted")).toBe(true);
    expect(
      screen.getByRole("button", { name: "Go to screen 1" }).classList.contains("bg-text-primary"),
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Go to screen 2" }).classList.contains("bg-surface-active"),
    ).toBe(true);
    expect(screen.queryByText("Show more")).toBeNull();
  });

  it("matches loading placeholders to carousel card dimensions and surfaces", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));

    const { container } = renderPage();

    const shimmer = container.querySelector(".animate-pulse");

    expect(shimmer?.classList.contains("bg-surface-base")).toBe(true);
    expect(shimmer?.classList.contains("rounded-[2rem]")).toBe(true);
    expect(shimmer?.classList.contains("px-12")).toBe(true);
    expect(shimmer?.classList.contains("sm:px-16")).toBe(true);
    expect((shimmer?.firstElementChild as HTMLElement)?.style.aspectRatio).toBe("390 / 844");
    expect(
      shimmer?.firstElementChild?.classList.contains("bg-surface-elevated"),
    ).toBe(false);
  });

  it("shows an empty-state message when there are no apps", async () => {
    vi.stubGlobal(
      "fetch",
      withCategories(async () => jsonResponse({ apps: [], nextCursor: null })),
    );

    renderPage();

    await screen.findByText("Nothing generated yet.");
  });

  it("renders the same empty-state message on a 503 (storage not configured)", async () => {
    vi.stubGlobal(
      "fetch",
      withCategories(async () =>
        jsonResponse({ error: "Showcase storage is not configured" }, 503),
      ),
    );

    renderPage();

    await screen.findByText("Nothing generated yet.");
  });

  it("shows an error message on other failures, without crashing", async () => {
    vi.stubGlobal(
      "fetch",
      withCategories(async () => jsonResponse({ error: "limit out of range" }, 400)),
    );

    renderPage();

    await screen.findByText("Couldn't load the showcase.");
    await screen.findByText("limit out of range");
  });

  it("loads the next page when the bottom sentinel enters the viewport", async () => {
    const intersectionObserver = installIntersectionObserver();
    const fetchMock = withCategories(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("cursor=")) {
        return jsonResponse({ apps: [app("r2", [screen2()])], nextCursor: null });
      }
      return jsonResponse({ apps: [app("r1", [screen1()])], nextCursor: "cursor-2" });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();

    await screen.findByAltText("Onboarding flow");
    await waitFor(() =>
      expect(screen.getByTestId("showcase-load-more-sentinel")).toBeTruthy(),
    );
    intersectionObserver.intersect();

    await screen.findByAltText("Checkout page");
    // Both pages are visible after loading more.
    expect(screen.getByAltText("Onboarding flow")).toBeTruthy();
    // No further cursor — the sentinel disappears.
    await waitFor(() =>
      expect(screen.queryByTestId("showcase-load-more-sentinel")).toBeNull(),
    );
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("renders screens without a caption, but with a copy-id click target", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ apps: [app("r1", [screen1()])], nextCursor: null })),
    );

    renderPage();

    const image = await screen.findByAltText("Onboarding flow");
    // The model is intentionally shown as a compact card badge, not a caption.
    expect(screen.getByText("Model").classList.contains("text-text-muted")).toBe(true);
    expect(screen.queryByText(/dark/)).toBeNull();
    // The live-HTML lightbox is switched off, but the card is still a real
    // <button> so clicking (or Enter/Space on) a screen copies its id.
    expect(image.closest("a")).toBeNull();
    const button = image.closest("button");
    expect(button).not.toBeNull();
    expect(button?.getAttribute("aria-label")).toBe(
      "Copy screen id: Onboarding flow",
    );
  });

  it("uses carousel-backed apps in a four-column maximum grid with compensated mobile gutters", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ apps: [app("r1", [screen1()])], nextCursor: null })),
    );

    const { container } = renderPage();

    const image = await screen.findByAltText("Onboarding flow");
    const page = container.firstElementChild;
    const header = page?.querySelector("header");
    const main = page?.querySelector("main");
    // The image's direct parent is now the copy-id <button>, so reach for the
    // card by its slot marker instead of by DOM position.
    const card = image.closest('[data-slot="showcase-card"]');
    const scroller = image.closest("ol");
    const appCarousel = scroller?.closest("[data-slot=showcase-app-carousel]");
    const grid = appCarousel?.parentElement;

    expect(page?.classList.contains("bg-white")).toBe(true);
    expect(appCarousel?.classList.contains("bg-surface-base")).toBe(true);
    expect(appCarousel?.classList.contains("py-10")).toBe(true);
    expect(appCarousel?.classList.contains("sm:py-12")).toBe(true);
    // The panel keeps only vertical padding — horizontal padding moved onto
    // the scroller so it scrolls with the content (that's what produces the
    // Mobbin-style peek at both edges).
    expect(scroller?.classList.contains("px-20")).toBe(true);
    expect(scroller?.classList.contains("sm:px-16")).toBe(true);
    expect(grid?.classList.contains("grid")).toBe(true);
    expect(grid?.classList.contains("grid-cols-1")).toBe(true);
    expect(grid?.classList.contains("sm:grid-cols-2")).toBe(true);
    expect(grid?.classList.contains("lg:grid-cols-3")).toBe(true);
    expect(grid?.classList.contains("xl:grid-cols-4")).toBe(true);
    // Horizontal padding is expressed as pl-/pr- (not the px- shorthand) so
    // it can carry the safe-area-inset addition on each side individually —
    // see ShowcasePage's comment above the header/main className.
    expect(header?.classList.contains("pl-[calc(1rem+env(safe-area-inset-left))]")).toBe(true);
    expect(header?.classList.contains("pr-[calc(1rem+env(safe-area-inset-right))]")).toBe(true);
    expect(header?.classList.contains("sm:pl-[calc(4rem+env(safe-area-inset-left))]")).toBe(true);
    expect(header?.classList.contains("sm:pr-[calc(4rem+env(safe-area-inset-right))]")).toBe(true);
    expect(main?.classList.contains("pl-[calc(1rem+env(safe-area-inset-left))]")).toBe(true);
    expect(main?.classList.contains("pr-[calc(1rem+env(safe-area-inset-right))]")).toBe(true);
    expect(main?.classList.contains("sm:pl-[calc(4rem+env(safe-area-inset-left))]")).toBe(true);
    expect(main?.classList.contains("sm:pr-[calc(4rem+env(safe-area-inset-right))]")).toBe(true);
    expect(header?.classList.contains("lg:max-w-none")).toBe(true);
    expect(main?.classList.contains("lg:max-w-none")).toBe(true);
    // screen1() is 390x844 (mobile portrait) — the aspect ratio is an inline
    // style derived from the screen's own width/height, not a static
    // Tailwind class, since a real desktop screen's ratio differs per row.
    expect((card as HTMLElement | null)?.style.aspectRatio).toBe("390 / 844");
    expect(card?.classList.contains("rounded-3xl")).toBe(true);
    // No `border` on the card itself — a real border participates in
    // border-box sizing, which WebKit and Blink resolve percentage heights
    // against differently, clipping 2px off screenshots in Safari (see
    // ShowcaseCard.tsx).
    expect(card?.classList.contains("border")).toBe(false);
    // The hairline instead lives on a dedicated overlay div painted after the
    // screenshot button, found structurally (its `aria-hidden` marker) rather
    // than by class, so this assertion can't pass vacuously if the overlay
    // were ever removed.
    const hairlineOverlay = card?.querySelector('[aria-hidden="true"]');
    expect(hairlineOverlay).not.toBeNull();
    expect(hairlineOverlay?.classList.contains("absolute")).toBe(true);
    expect(hairlineOverlay?.classList.contains("inset-0")).toBe(true);
    expect(hairlineOverlay?.classList.contains("inset-ring-1")).toBe(true);
    expect(hairlineOverlay?.classList.contains("inset-ring-gray-200")).toBe(true);
  });

  it("marks <html> as the showcase route and whitens theme-color while mounted, undoing both on unmount", async () => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    meta.setAttribute("content", "#111111");
    document.head.appendChild(meta);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ apps: [app("r1", [screen1()])], nextCursor: null })),
    );

    try {
      expect(document.documentElement.classList.contains("route-showcase")).toBe(
        false,
      );

      const { unmount } = renderPage();
      await screen.findByAltText("Onboarding flow");

      expect(document.documentElement.classList.contains("route-showcase")).toBe(
        true,
      );
      expect(meta.getAttribute("content")).toBe("#ffffff");

      unmount();

      expect(document.documentElement.classList.contains("route-showcase")).toBe(
        false,
      );
      expect(meta.getAttribute("content")).toBe("#111111");
    } finally {
      meta.remove();
    }
  });
});

describe("<ShowcasePage /> filters", () => {
  it("defaults to Most popular with no query params, and requests sort=popular", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/showcase/categories")) {
        return categoriesResponse([{ theme: "mobile banking", apps: 2 }]);
      }
      expect(url).toContain("sort=popular");
      expect(url).not.toContain("category=");
      return jsonResponse({ apps: [app("r1", [screen1()])], nextCursor: null });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPageAt("/");

    await screen.findByAltText("Onboarding flow");
    expect(currentSearch()).toBe("");
    expect(
      screen.getByRole("button", { name: "Most popular" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("clicking Latest requests sort=latest and writes it to the URL, without touching the canonical default on Most popular", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/showcase/categories")) {
        return categoriesResponse([]);
      }
      return jsonResponse({
        apps: [app("r1", [screen1()], url.includes("sort=latest") ? 0 : 1)],
        nextCursor: null,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPageAt("/");
    await screen.findByAltText("Onboarding flow");

    fireEvent.click(screen.getByRole("button", { name: "Latest" }));

    await waitFor(() => expect(currentSearch()).toBe("?sort=latest"));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) => String(input).includes("sort=latest")),
      ).toBe(true),
    );
  });

  it("clicking a category chip requests and URL-encodes it, and resets to page 1", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/showcase/categories")) {
        return categoriesResponse([{ theme: "mobile banking", apps: 2 }]);
      }
      if (url.includes("category=mobile+banking")) {
        return jsonResponse({ apps: [app("r2", [screen2()])], nextCursor: null });
      }
      return jsonResponse({ apps: [app("r1", [screen1()])], nextCursor: "cursor-2" });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPageAt("/");
    await screen.findByAltText("Onboarding flow");

    fireEvent.click(screen.getByRole("button", { name: "Mobile banking" }));

    await screen.findByAltText("Checkout page");
    expect(currentSearch()).toBe("?category=mobile+banking");
    expect(screen.queryByAltText("Onboarding flow")).toBeNull();
  });

  it("restores sort and category from the URL on load", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/showcase/categories")) {
        return categoriesResponse([{ theme: "mobile banking", apps: 2 }]);
      }
      expect(url).toContain("sort=latest");
      expect(url).toContain("category=mobile+banking");
      return jsonResponse({ apps: [app("r1", [screen1()])], nextCursor: null });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPageAt("/?sort=latest&category=mobile+banking");

    await screen.findByAltText("Onboarding flow");
    expect(
      screen.getByRole("button", { name: "Latest" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "Mobile banking" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("restores a category from the URL that isn't in the chip list without breaking the row", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/showcase/categories")) {
        return categoriesResponse([{ theme: "mobile banking", apps: 2 }]);
      }
      return jsonResponse({ apps: [], nextCursor: null });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPageAt("/?category=retro+arcade");

    await screen.findByText("Nothing generated in this category yet.");
    expect(
      screen.getByRole("button", { name: "Mobile banking" }).getAttribute("aria-pressed"),
    ).toBe("false");
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("shows an empty state with a reset-to-All button for a category with no apps", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/showcase/categories")) {
        return categoriesResponse([{ theme: "mobile banking", apps: 2 }]);
      }
      if (url.includes("category=")) {
        return jsonResponse({ apps: [], nextCursor: null });
      }
      return jsonResponse({ apps: [app("r1", [screen1()])], nextCursor: null });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPageAt("/?category=mobile+banking");

    await screen.findByText("Nothing generated in this category yet.");
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));

    await screen.findByAltText("Onboarding flow");
    expect(currentSearch()).toBe("");
  });

  it("defaults to the mobile platform with no query param, and requests platform=mobile without writing it to the URL", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/showcase/categories")) {
        expect(url).toContain("platform=mobile");
        return categoriesResponse([]);
      }
      expect(url).toContain("platform=mobile");
      return jsonResponse({ apps: [app("r1", [screen1()])], nextCursor: null });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPageAt("/");

    await screen.findByAltText("Onboarding flow");
    expect(currentSearch()).toBe("");
    expect(
      screen.getByRole("button", { name: "Mobile" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("clicking the Web toggle requests platform=desktop, writes it to the URL, and re-fetches categories for the new platform", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/showcase/categories")) {
        return categoriesResponse(
          url.includes("platform=desktop")
            ? [{ theme: "landing page", apps: 4 }]
            : [{ theme: "mobile banking", apps: 2 }],
        );
      }
      return jsonResponse({
        apps: [app("r1", [screen1()], url.includes("platform=desktop") ? 0 : 1)],
        nextCursor: null,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPageAt("/");
    await screen.findByAltText("Onboarding flow");

    fireEvent.click(screen.getByRole("button", { name: "Web" }));

    await waitFor(() => expect(currentSearch()).toBe("?platform=desktop"));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) => String(input).includes("platform=desktop")),
      ).toBe(true),
    );
    // The new platform's own categories replace the old ones.
    await screen.findByRole("button", { name: "Landing page" });
    expect(screen.queryByRole("button", { name: "Mobile banking" })).toBeNull();
  });

  it("switching platform resets an active category instead of carrying it over to a platform whose chip list doesn't recognize it", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/showcase/categories")) {
        return categoriesResponse([{ theme: "mobile banking", apps: 2 }]);
      }
      return jsonResponse({ apps: [app("r1", [screen1()])], nextCursor: null });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPageAt("/?category=mobile+banking");
    await screen.findByAltText("Onboarding flow");
    expect(
      screen.getByRole("button", { name: "Mobile banking" }).getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Web" }));

    await waitFor(() => expect(currentSearch()).toBe("?platform=desktop"));
    expect(currentSearch()).not.toContain("category=");
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input]) =>
            String(input).includes("platform=desktop") &&
            !String(input).includes("category="),
        ),
      ).toBe(true),
    );
  });

  it("restores platform=desktop from the URL and marks the Web toggle active", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/showcase/categories")) {
        return categoriesResponse([]);
      }
      expect(url).toContain("platform=desktop");
      return jsonResponse({ apps: [app("r1", [screen1()])], nextCursor: null });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPageAt("/?platform=desktop");

    await screen.findByAltText("Onboarding flow");
    expect(
      screen.getByRole("button", { name: "Web" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("treats an invalid platform value in the URL as the mobile default", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/showcase/categories")) {
        return categoriesResponse([]);
      }
      expect(url).toContain("platform=mobile");
      return jsonResponse({ apps: [app("r1", [screen1()])], nextCursor: null });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPageAt("/?platform=nonsense");

    await screen.findByAltText("Onboarding flow");
    expect(
      screen.getByRole("button", { name: "Mobile" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("discards a stale filter response instead of clobbering the newer one", async () => {
    // Wrapped in an object rather than a bare `let` — TS's control-flow
    // narrowing doesn't track a reassignment that only happens inside a
    // nested closure, and ends up narrowing a bare `let` to `null` forever.
    const popular: { resolve: ((res: Response) => void) | null } = { resolve: null };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/showcase/categories")) {
        return categoriesResponse([]);
      }
      if (url.includes("sort=latest")) {
        return jsonResponse({ apps: [app("r-latest", [screen2()])], nextCursor: null });
      }
      // The initial (default, sort=popular) request never resolves until we
      // release it below, well after the user has already switched to Latest.
      return new Promise<Response>((resolve) => {
        popular.resolve = resolve;
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPageAt("/");
    fireEvent.click(await screen.findByRole("button", { name: "Latest" }));

    await screen.findByAltText("Checkout page");

    // Now let the stale "popular" response land — it must not overwrite the
    // grid with data for a filter nobody has selected anymore.
    popular.resolve?.(jsonResponse({ apps: [app("r1", [screen1()])], nextCursor: null }));

    await waitFor(() => expect(screen.queryByAltText("Onboarding flow")).toBeNull());
    expect(screen.getByAltText("Checkout page")).toBeTruthy();
  });

  it("discards an infinite-scroll response that outlives a popular -> latest -> popular round trip", async () => {
    const intersectionObserver = installIntersectionObserver();
    // Reproduces the exact reported sequence: page 1 loads, the sentinel
    // starts page 2 and hangs, the visitor bounces to Latest and back to Most
    // popular (both resolve normally), and only then does the stale page-2
    // response land. A guard that compares filter *values* sees the same
    // {sort: "popular", category: null} both times pagination was triggered
    // under and lets the stale response through — duplicating a card (React
    // warns on the repeated key) and clobbering `nextCursor` back to the
    // stale page's `null`, which removes the current pagination sentinel.
    const popularPage2: { resolve: ((res: Response) => void) | null } = { resolve: null };
    const reloadScreen: ShowcaseScreen = { ...screen1(), id: "s4", title: "Popular reload" };
    let popularPage1Requests = 0;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/showcase/categories")) {
        return categoriesResponse([]);
      }
      if (url.includes("sort=latest")) {
        return jsonResponse({ apps: [app("r-latest", [screen3()])], nextCursor: null });
      }
      // Everything else is sort=popular (the default, never written to the URL).
      if (url.includes("cursor=cursor-2")) {
        // The page-2 request hangs until released below, by which
        // point the visitor has already gone to Latest and back.
        return new Promise<Response>((resolve) => {
          popularPage2.resolve = resolve;
        });
      }
      popularPage1Requests += 1;
      if (popularPage1Requests > 1) {
        // Second lap through "popular" page 1 (after the trip to Latest).
        return jsonResponse({ apps: [app("r1b", [reloadScreen])], nextCursor: "cursor-3" });
      }
      // First lap: popular page 1.
      return jsonResponse({ apps: [app("r1", [screen1()])], nextCursor: "cursor-2" });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();
    await screen.findByAltText("Onboarding flow");

    await waitFor(() =>
      expect(screen.getByTestId("showcase-load-more-sentinel")).toBeTruthy(),
    );
    intersectionObserver.intersect();
    // The page-2 request is now in flight (and will hang until we resolve it
    // further down).

    fireEvent.click(screen.getByRole("button", { name: "Latest" }));
    await screen.findByAltText("Onboarding details");

    fireEvent.click(screen.getByRole("button", { name: "Most popular" }));
    await screen.findByAltText("Popular reload");
    // `loadingMore` is page-scoped and is still pinned true by the
    // never-resolved page-2 request.
    // The page-1 fetch for this second popular lap already set a fresh
    // `nextCursor` ("cursor-3") independently of `loadingMore`, though, and
    // that's what the assertions below check survives the stale response.
    expect(screen.getByRole("status").textContent).toBe("Loading more…");

    // Now let the long-hung page-2 response land.
    popularPage2.resolve?.(
      jsonResponse({ apps: [app("r-stale", [screen2()])], nextCursor: null }),
    );

    // It must never appear — neither as a duplicated card nor by clobbering
    // the current page's nextCursor (which would remove the sentinel once
    // `loadingMore` clears).
    await waitFor(() => expect(screen.queryByAltText("Checkout page")).toBeNull());
    expect(screen.getByAltText("Popular reload")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId("showcase-load-more-sentinel")).toBeTruthy(),
    );
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
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
      <ShowcaseLightbox
        screen={screen1()}
        theme="dark"
        model="test/model"
        onOpenChange={() => {}}
      />,
    );

    const iframe = await screen.findByTitle("Onboarding flow");
    const sandbox = iframe.getAttribute("sandbox") ?? "";
    expect(sandbox.split(/\s+/)).toContain("allow-scripts");
    expect(sandbox.split(/\s+/)).not.toContain("allow-same-origin");
  });
});
