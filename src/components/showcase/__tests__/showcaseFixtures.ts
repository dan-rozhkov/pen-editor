import { vi } from "vitest";
import type { ShowcaseApp, ShowcaseCategory, ShowcaseScreen } from "@/lib/showcase";

// Shared fixtures for ShowcasePage.test.tsx / ShowcasePage.analytics.test.tsx —
// both render <ShowcasePage /> against a stubbed `fetch` and need the same
// screen/app shapes and categories/models routing.

export function screen1(): ShowcaseScreen {
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

export function screen2(): ShowcaseScreen {
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

export function app(
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

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// The page always fetches /api/showcase/categories and /api/showcase/models
// alongside the feed; tests that only care about the feed response route both
// to a fixture response so the mock doesn't need a per-test branch for them.
export function withCategories(
  handler: (input: RequestInfo | URL) => Promise<Response> | Response,
  categories: ShowcaseCategory[] = [],
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

export function installIntersectionObserver() {
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
