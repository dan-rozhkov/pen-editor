import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";

// Module-mock pattern mirrors src/lib/__tests__/bridgeBootstrap.test.ts: the
// whole analytics module is replaced so `track()` calls can be asserted on
// without a real PostHog client ever being touched.
const { trackMock } = vi.hoisted(() => ({ trackMock: vi.fn() }));
vi.mock("@/lib/analytics", () => ({
  track: trackMock,
}));

import { ShowcasePage } from "@/components/showcase/ShowcasePage";
import type { ShowcaseApp, ShowcaseCategory, ShowcaseScreen } from "@/lib/showcase";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  trackMock.mockClear();
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

function app(runId: string, screens: ShowcaseScreen[]): ShowcaseApp {
  return {
    runId,
    theme: "dark",
    model: "test/model",
    createdAt: screens[0].createdAt,
    likes: 0,
    platform: "mobile",
    screens,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function withCategories(
  handler: (input: RequestInfo | URL) => Promise<Response> | Response,
  categories: ShowcaseCategory[] = [{ theme: "mobile banking", apps: 2 }],
) {
  return vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/api/showcase/categories")) {
      return jsonResponse({ categories });
    }
    if (String(input).includes("/api/showcase/models")) {
      return jsonResponse({ models: [] });
    }
    return handler(input);
  });
}

// Mirrors installIntersectionObserver() in ShowcasePage.test.tsx.
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
    hasTarget() {
      return target != null;
    },
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

function renderPageAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ShowcasePage />
    </MemoryRouter>,
  );
}

describe("ShowcasePage analytics", () => {
  it("fires showcase_viewed exactly once on mount, with the active filters, and not again on a filter change", async () => {
    const fetchMock = withCategories(async (input) => {
      const url = String(input);
      return jsonResponse({
        apps: [app(url.includes("sort=latest") ? "r-latest" : "r1", [screen1()])],
        nextCursor: null,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPageAt("/?category=mobile+banking");
    await screen.findByAltText("Onboarding flow");

    const viewedCalls = trackMock.mock.calls.filter(([event]) => event === "showcase_viewed");
    expect(viewedCalls).toHaveLength(1);
    expect(viewedCalls[0][1]).toEqual({
      platform: "mobile",
      category: "mobile banking",
      sort: "popular",
    });

    trackMock.mockClear();

    // Changing sort re-fetches the feed but must not re-fire showcase_viewed
    // — that event is mount-scoped only.
    fireEvent.change(screen.getByRole("combobox", { name: "Sort" }), {
      target: { value: "latest" },
    });
    await screen.findByAltText("Onboarding flow");

    expect(trackMock.mock.calls.some(([event]) => event === "showcase_viewed")).toBe(false);
  });

  it("fires showcase_filter_applied with the filter and value on a sort change", async () => {
    const fetchMock = withCategories(async () =>
      jsonResponse({ apps: [app("r1", [screen1()])], nextCursor: null }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderPageAt("/");
    await screen.findByAltText("Onboarding flow");
    trackMock.mockClear();

    fireEvent.change(screen.getByRole("combobox", { name: "Sort" }), {
      target: { value: "latest" },
    });

    await waitFor(() =>
      expect(trackMock).toHaveBeenCalledWith("showcase_filter_applied", {
        filter: "sort",
        value: "latest",
      }),
    );
  });

  it("fires showcase_filter_applied with the filter and value on a category chip click", async () => {
    const fetchMock = withCategories(async (input) => {
      const url = String(input);
      if (url.includes("category=mobile+banking")) {
        return jsonResponse({ apps: [app("r2", [screen2()])], nextCursor: null });
      }
      return jsonResponse({ apps: [app("r1", [screen1()])], nextCursor: null });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPageAt("/");
    await screen.findByAltText("Onboarding flow");
    trackMock.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Mobile banking" }));

    await waitFor(() =>
      expect(trackMock).toHaveBeenCalledWith("showcase_filter_applied", {
        filter: "category",
        value: "mobile banking",
      }),
    );
  });

  it("fires showcase_feed_paginated with page and apps_loaded when the sentinel triggers a load", async () => {
    const intersectionObserver = installIntersectionObserver();

    const fetchMock = withCategories(async (input) => {
      const url = String(input);
      if (url.includes("cursor=")) {
        return jsonResponse({ apps: [app("r2", [screen2()])], nextCursor: null });
      }
      return jsonResponse({ apps: [app("r1", [screen1()])], nextCursor: "cursor-2" });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPageAt("/");
    await screen.findByAltText("Onboarding flow");
    await waitFor(() => expect(intersectionObserver.hasTarget()).toBe(true));
    trackMock.mockClear();

    intersectionObserver.intersect();

    await screen.findByAltText("Checkout page");
    expect(trackMock).toHaveBeenCalledWith("showcase_feed_paginated", {
      page: 2,
      apps_loaded: 1,
    });
  });

  it("fires showcase_editor_cta_clicked with source 'header' and no app_id on the header link", async () => {
    const fetchMock = withCategories(async () =>
      jsonResponse({ apps: [app("r1", [screen1()])], nextCursor: null }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderPageAt("/");
    await screen.findByAltText("Onboarding flow");
    trackMock.mockClear();

    fireEvent.click(screen.getByRole("link", { name: "Open the editor →" }));

    expect(trackMock).toHaveBeenCalledWith("showcase_editor_cta_clicked", {
      source: "header",
    });
  });
});
