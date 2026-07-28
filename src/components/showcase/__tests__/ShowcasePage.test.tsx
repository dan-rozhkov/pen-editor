import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ShowcasePage } from "@/components/showcase/ShowcasePage";
import { ShowcaseLightbox } from "@/components/showcase/ShowcaseLightbox";
import type { ShowcaseApp, ShowcaseScreen } from "@/lib/showcase";

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
function app(runId: string, screens: ShowcaseScreen[]): ShowcaseApp {
  return {
    runId,
    theme: "dark",
    model: "test/model",
    createdAt: screens[0].createdAt,
    screens,
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
  it("renders one carousel per app, with all of its screens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
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
    expect(nextScreen.classList.contains("hover:text-white")).toBe(true);
    // Inside the panel, not hanging off it: the panel's horizontal padding
    // moved onto the scroller (it is what produces the peek), so a negative
    // offset would put the arrow outside the panel's `overflow-hidden` box.
    expect(nextScreen.classList.contains("right-1")).toBe(true);
    expect(nextScreen.classList.contains("sm:right-3")).toBe(true);
    expect(nextScreen.classList.contains("text-white")).toBe(true);
    expect(selector.classList.contains("absolute")).toBe(true);
    expect(selector.classList.contains("top-5")).toBe(true);
    expect(selector.classList.contains("right-5")).toBe(true);
    expect(selector.classList.contains("opacity-0")).toBe(false);
    const [modelBadge] = screen.getAllByText("Model");
    expect(modelBadge.classList.contains("bottom-3")).toBe(true);
    expect(modelBadge.classList.contains("left-1/2")).toBe(true);
    expect(modelBadge.classList.contains("-translate-x-1/2")).toBe(true);
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
    const skeletonCard = shimmer?.parentElement;

    expect(skeletonCard?.classList.contains("bg-surface-base")).toBe(true);
    expect(skeletonCard?.classList.contains("rounded-[2rem]")).toBe(true);
    expect(skeletonCard?.classList.contains("px-12")).toBe(true);
    expect(skeletonCard?.classList.contains("sm:px-16")).toBe(true);
    expect(shimmer?.classList.contains("aspect-[390/844]")).toBe(true);
    expect(shimmer?.classList.contains("rounded-3xl")).toBe(true);
  });

  it("shows an empty-state message when there are no apps", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ apps: [], nextCursor: null })),
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
        return jsonResponse({ apps: [app("r2", [screen2()])], nextCursor: null });
      }
      return jsonResponse({ apps: [app("r1", [screen1()])], nextCursor: "cursor-2" });
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

  it("uses carousel-backed apps in a four-column maximum grid with doubled side gutters", async () => {
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
    expect(scroller?.classList.contains("px-12")).toBe(true);
    expect(scroller?.classList.contains("sm:px-16")).toBe(true);
    expect(grid?.classList.contains("grid")).toBe(true);
    expect(grid?.classList.contains("grid-cols-1")).toBe(true);
    expect(grid?.classList.contains("sm:grid-cols-2")).toBe(true);
    expect(grid?.classList.contains("lg:grid-cols-3")).toBe(true);
    expect(grid?.classList.contains("xl:grid-cols-4")).toBe(true);
    // Horizontal padding is expressed as pl-/pr- (not the px- shorthand) so
    // it can carry the safe-area-inset addition on each side individually —
    // see ShowcasePage's comment above the header/main className.
    expect(header?.classList.contains("pl-[calc(3rem+env(safe-area-inset-left))]")).toBe(true);
    expect(header?.classList.contains("pr-[calc(3rem+env(safe-area-inset-right))]")).toBe(true);
    expect(header?.classList.contains("sm:pl-[calc(4rem+env(safe-area-inset-left))]")).toBe(true);
    expect(header?.classList.contains("sm:pr-[calc(4rem+env(safe-area-inset-right))]")).toBe(true);
    expect(main?.classList.contains("pl-[calc(3rem+env(safe-area-inset-left))]")).toBe(true);
    expect(main?.classList.contains("pr-[calc(3rem+env(safe-area-inset-right))]")).toBe(true);
    expect(main?.classList.contains("sm:pl-[calc(4rem+env(safe-area-inset-left))]")).toBe(true);
    expect(main?.classList.contains("sm:pr-[calc(4rem+env(safe-area-inset-right))]")).toBe(true);
    expect(header?.classList.contains("lg:max-w-none")).toBe(true);
    expect(main?.classList.contains("lg:max-w-none")).toBe(true);
    expect(card?.classList.contains("aspect-[390/844]")).toBe(true);
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
