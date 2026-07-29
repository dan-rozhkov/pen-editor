import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { ShowcaseAgentComposer } from "@/components/showcase/ShowcaseAgentComposer";
import { ShowcaseFilterBar } from "@/components/showcase/ShowcaseFilterBar";
import { Button } from "@/components/ui/button";
import { storeShowcaseAgentPrompt } from "@/lib/showcaseAgentHandoff";
import { cn } from "@/lib/utils";
import {
  fetchShowcase,
  fetchShowcaseCategories,
  type ShowcaseApp,
  type ShowcaseCategory,
  type ShowcaseSort,
} from "@/lib/showcase";
import { ShowcaseAppCarousel } from "@/components/showcase/ShowcaseAppCarousel";

type Status = "loading" | "ready" | "error";

function parseSort(value: string | null): ShowcaseSort {
  return value === "latest" ? "latest" : "popular";
}

// `?category=` (present but empty — e.g. typed by hand, or left behind by a
// stripped chip) reads back as `""` from URLSearchParams, not `null`. Every
// consumer of `category` in this file (the request, the empty-state branch,
// `filtersKey`, the "All" chip's active state) must agree on what "no
// category" looks like, so normalizing happens once, here, rather than at
// each call site.
function parseCategory(value: string | null): string | null {
  return value ? value : null;
}

function ShowcaseGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {children}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div aria-hidden="true">
      <ShowcaseGrid>
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="animate-pulse rounded-[2rem] bg-surface-base px-12 py-10 sm:px-16 sm:py-12"
          >
            <div className="aspect-[390/844]" />
          </div>
        ))}
      </ShowcaseGrid>
    </div>
  );
}

export function ShowcasePage() {
  const navigate = useNavigate();
  // `useSearchParams` is the single source of truth for filter state — no
  // duplicated `useState`. Defaults (`sort=popular`, no category) are never
  // written to the URL, so the canonical "/" stays clean; the reverse
  // (`?sort=popular` explicitly in the URL) is treated the same as absent.
  const [searchParams, setSearchParams] = useSearchParams();
  const sort = parseSort(searchParams.get("sort"));
  const category = parseCategory(searchParams.get("category"));

  // Apps, not screens: the feed hands back whole apps (see lib/showcase.ts),
  // so pages append cleanly and no card is ever rendered half-populated.
  const [apps, setApps] = useState<ShowcaseApp[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [categories, setCategories] = useState<ShowcaseCategory[]>([]);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);

  // Monotonic id for the most recent request against the feed — bumped both
  // when the filters change (a new page-1 fetch, in the effect below) and
  // before every next-page request. A response is only applied if this ref
  // still holds the id it was issued under. That's a different question from
  // "do the filter *values* still match" (the guard this replaced): popular
  // -> latest -> popular makes the values equal again while page 1 (latest)
  // and the stale page-2 (the first popular lap) are two different requests
  // for the same-looking filters — a value comparison can't tell those
  // apart, which is exactly what let a stale pagination response reappear
  // and get appended after that sequence.
  const requestIdRef = useRef(0);

  // Drop back to the skeleton the moment the filters change, not after the
  // fetch effect below gets around to it — setting state synchronously
  // inside an effect body is a lint error (cascading renders), so this
  // follows the same "adjust state during render" pattern ShowcaseAppCarousel
  // already uses for its screensKey: compare the new key against the last one
  // rendered, and if it moved, call the setters right here rather than in an
  // effect. React re-renders immediately before committing, so nothing ever
  // paints the stale grid under the new filter's tab/chip.
  const filtersKey = `${sort}|${category ?? ""}`;
  const [loadedFiltersKey, setLoadedFiltersKey] = useState(filtersKey);
  if (loadedFiltersKey !== filtersKey) {
    setLoadedFiltersKey(filtersKey);
    setStatus("loading");
    setErrorMessage(null);
  }

  // Categories only ever need to load once — the chip list itself doesn't
  // depend on which chip is selected. A failure (or an empty database) just
  // means the chip row doesn't render; the sort tabs still work on their own.
  useEffect(() => {
    let cancelled = false;
    fetchShowcaseCategories().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setCategories(result.categories);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Changing sort or category resets the cursor and refetches page 1. The
  // filter row itself stays mounted (it's rendered outside this effect's
  // control below); only the grid drops back to the skeleton.
  useEffect(() => {
    let cancelled = false;
    // Bumping here (not just reading) is what invalidates any next-page
    // request already in flight for the previous filters — see
    // `requestIdRef`'s comment above.
    requestIdRef.current += 1;
    fetchShowcase(null, undefined, { sort, category }).then((result) => {
      // `cancelled` (set by this effect's own cleanup, below) already covers
      // "this exact effect instance was torn down or superseded" — a
      // filter-value comparison here would be redundant with it, not an
      // additional safety net, so there's nothing else to check.
      if (cancelled) return;
      if (!result.ok) {
        if (result.notConfigured) {
          // 503 (storage not configured) reads identically to an empty feed.
          setApps([]);
          setNextCursor(null);
          setStatus("ready");
        } else {
          setErrorMessage(result.error);
          setStatus("error");
        }
        return;
      }
      setApps(result.data.apps);
      setNextCursor(result.data.nextCursor);
      setStatus("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [sort, category]);

  const handleLoadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    // Captured *after* incrementing, so this request owns the id it checks
    // against below. If the filter-change effect bumps the ref again before
    // this resolves — the user switched tabs while infinite-scroll loading was
    // flight — the comparison fails and the response is dropped instead of
    // being appended to a list built under different filters.
    const requestId = ++requestIdRef.current;
    const result = await fetchShowcase(nextCursor, undefined, { sort, category });
    if (requestIdRef.current === requestId && result.ok) {
      setApps((prev) => [...prev, ...result.data.apps]);
      setNextCursor(result.data.nextCursor);
    }
    // A failure loading more leaves the current page in place; because the
    // sentinel remains mounted, scrolling away and back allows a retry. A
    // stale response (filters changed mid-request) is silently dropped.
    setLoadingMore(false);
  }, [category, loadingMore, nextCursor, sort]);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (
      !sentinel ||
      status !== "ready" ||
      nextCursor == null ||
      loadingMore ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          void handleLoadMore();
        }
      },
      // Start the request before the visitor reaches the final row so the
      // next page can append without a visible pause at the bottom.
      { rootMargin: "600px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [handleLoadMore, loadingMore, nextCursor, status]);

  function updateFilters(next: { sort?: ShowcaseSort; category?: string | null }) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next.sort !== undefined) {
          if (next.sort === "popular") {
            params.delete("sort");
          } else {
            params.set("sort", next.sort);
          }
        }
        if (next.category !== undefined) {
          if (next.category === null) {
            params.delete("category");
          } else {
            params.set("category", next.category);
          }
        }
        return params;
      },
      { replace: true },
    );
  }

  function handleAgentPrompt(prompt: string) {
    storeShowcaseAgentPrompt(prompt);
    navigate("/app");
  }

  const isEmpty = status === "ready" && apps.length === 0;

  // index.css locks html/body/#root to height:100% + overflow:hidden so the
  // editor at "/app" owns a fixed viewport. That lock is what turned iOS
  // Safari's collapsing address bar into a grey band here: `height:100%`
  // resolves against the small viewport, so the strips behind the
  // expanding/collapsing chrome fell outside the box and painted with the
  // body background. The fix is real document scroll, not a scroller nested
  // inside a fixed-height box — only document scroll lets Safari collapse its
  // chrome and content pass under it. `route-showcase` (toggled below) turns
  // off the lock while this page is mounted, without touching it for "/app".
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add("route-showcase");
    const meta = document.querySelector('meta[name="theme-color"]');
    const previousThemeColor = meta?.getAttribute("content") ?? null;
    meta?.setAttribute("content", "#ffffff");
    return () => {
      html.classList.remove("route-showcase");
      if (previousThemeColor !== null) {
        meta?.setAttribute("content", previousThemeColor);
      }
    };
  }, []);

  return (
    <div className="min-h-[100dvh] bg-white">
      <header
        className={cn(
          "mx-auto max-w-6xl pb-8 lg:max-w-none",
          // pl-/pr-/pt- (not the px-/pt- shorthand) so the safe-area addition
          // below is the only rule touching each side — no shorthand vs.
          // longhand ordering to worry about. `env(safe-area-inset-*)` is 0
          // on browsers/orientations without a safe area, so this is just
          // pt-12/px-4/sm:px-16 plus Safari's status bar and, in landscape,
          // its side insets.
          "pt-[calc(3rem+env(safe-area-inset-top))]",
          "pl-[calc(1rem+env(safe-area-inset-left))] pr-[calc(1rem+env(safe-area-inset-right))]",
          "sm:pl-[calc(4rem+env(safe-area-inset-left))] sm:pr-[calc(4rem+env(safe-area-inset-right))]",
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-[clamp(2.25rem,4vw,3.25rem)] leading-[1.05] font-semibold tracking-tight text-text-primary">
            Design, on autopilot.
          </h1>
          <button
            type="button"
            onClick={() => navigate("/app")}
            className="inline-flex shrink-0 items-center rounded-lg bg-accent-primary/10 px-4 py-2 text-sm font-medium text-accent-primary transition-colors hover:bg-accent-primary/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary"
          >
            Open the editor →
          </button>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-text-muted">
          Every screen below was designed autonomously by the AI design
          agent — no human touched a mouse or keyboard.
        </p>
        <ShowcaseAgentComposer onSubmit={handleAgentPrompt} />
      </header>

      <main
        className={cn(
          "mx-auto max-w-6xl lg:max-w-none",
          // Same pl-/pr- reasoning as the header above; pb- adds Safari's
          // bottom inset so the final row isn't hidden behind the address
          // bar.
          "pb-[calc(4rem+env(safe-area-inset-bottom))]",
          "pl-[calc(1rem+env(safe-area-inset-left))] pr-[calc(1rem+env(safe-area-inset-right))]",
          "sm:pl-[calc(4rem+env(safe-area-inset-left))] sm:pr-[calc(4rem+env(safe-area-inset-right))]",
        )}
      >
        <div className="mb-6">
          <ShowcaseFilterBar
            sort={sort}
            category={category}
            categories={categories}
            onSortChange={(newSort) => updateFilters({ sort: newSort })}
            onCategoryChange={(newCategory) => updateFilters({ category: newCategory })}
          />
        </div>

        {status === "loading" && <SkeletonGrid />}

        {status === "error" && (
          <div className="rounded-lg bg-surface-panel px-6 py-10 text-center ring-1 ring-border-default">
            <p className="text-sm text-text-primary">
              Couldn't load the showcase.
            </p>
            <p className="mt-1 text-xs text-text-muted">{errorMessage}</p>
          </div>
        )}

        {isEmpty && category != null && (
          <div className="rounded-lg bg-surface-panel px-6 py-10 text-center ring-1 ring-border-default">
            <p className="text-sm text-text-primary">
              Nothing generated in this category yet.
            </p>
            <p className="mt-1 text-xs text-text-muted">
              Check back soon, or browse everything the agent has designed.
            </p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => updateFilters({ category: null })}
            >
              Show all
            </Button>
          </div>
        )}

        {isEmpty && category == null && (
          <div className="rounded-lg bg-surface-panel px-6 py-10 text-center ring-1 ring-border-default">
            <p className="text-sm text-text-primary">
              Nothing generated yet.
            </p>
            <p className="mt-1 text-xs text-text-muted">
              Check back soon — the showcase fills up as the agent designs new
              screens on its own.
            </p>
          </div>
        )}

        {status === "ready" && apps.length > 0 && (
          <>
            <ShowcaseGrid>
              {apps.map((app, index) => (
                <ShowcaseAppCarousel key={app.runId} app={app} isFirstInGrid={index === 0} />
              ))}
            </ShowcaseGrid>

            {nextCursor != null && (
              <div
                ref={loadMoreSentinelRef}
                data-testid="showcase-load-more-sentinel"
                aria-hidden="true"
                className="h-px"
              />
            )}
            {loadingMore && <p className="sr-only" role="status">Loading more…</p>}
          </>
        )}
      </main>
    </div>
  );
}
