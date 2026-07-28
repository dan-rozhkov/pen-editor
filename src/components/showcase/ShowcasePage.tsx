import { type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fetchShowcase, type ShowcaseScreen } from "@/lib/showcase";
import { ShowcaseAppCarousel } from "@/components/showcase/ShowcaseAppCarousel";
import { groupScreensByApp } from "@/components/showcase/showcaseApps";

type Status = "loading" | "ready" | "error";

function ShowcaseGrid({ children }: { children: ReactNode }) {
  return (
    // `items-start`, not the default `stretch`: slides are shaped by the
    // screen they hold (ShowcaseCard), so a row can mix a 750x1624 app with a
    // 750x2082 one. Stretched, the short panels grow to the row's height and
    // their `items-center` scroller floats the card in the middle, so no two
    // screens in a row start at the same y — the eye reads that as misaligned.
    // Letting each panel hug its own screens keeps every top edge on one line
    // and only the bottoms ragged.
    <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
            className="rounded-[2rem] bg-surface-base px-12 py-10 sm:px-16 sm:py-12"
          >
            <div className="aspect-[390/844] animate-pulse rounded-3xl bg-surface-elevated" />
          </div>
        ))}
      </ShowcaseGrid>
    </div>
  );
}

export function ShowcasePage() {
  const [screens, setScreens] = useState<ShowcaseScreen[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchShowcase(null).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        if (result.notConfigured) {
          // 503 (storage not configured) reads identically to an empty feed.
          setScreens([]);
          setNextCursor(null);
          setStatus("ready");
        } else {
          setErrorMessage(result.error);
          setStatus("error");
        }
        return;
      }
      setScreens(result.data.screens);
      setNextCursor(result.data.nextCursor);
      setStatus("ready");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLoadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const result = await fetchShowcase(nextCursor);
    if (result.ok) {
      setScreens((prev) => [...prev, ...result.data.screens]);
      setNextCursor(result.data.nextCursor);
    }
    // A failure loading more just leaves the current page in place; the
    // "Show more" button stays put so the user can retry.
    setLoadingMore(false);
  }

  const isEmpty = status === "ready" && screens.length === 0;
  const apps = groupScreensByApp(screens);

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
          // pt-12/px-12/sm:px-16 plus Safari's status bar and, in landscape,
          // its side insets.
          "pt-[calc(3rem+env(safe-area-inset-top))]",
          "pl-[calc(3rem+env(safe-area-inset-left))] pr-[calc(3rem+env(safe-area-inset-right))]",
          "sm:pl-[calc(4rem+env(safe-area-inset-left))] sm:pr-[calc(4rem+env(safe-area-inset-right))]",
        )}
      >
        <h1 className="text-2xl font-semibold text-text-primary">
          Pen Editor Showcase
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-text-muted">
          Every screen below was designed autonomously by the AI design
          agent — no human touched a mouse or keyboard.
        </p>
        <Link
          to="/app"
          className="mt-4 inline-flex text-sm font-medium text-accent-primary hover:underline"
        >
          Open the editor →
        </Link>
      </header>

      <main
        className={cn(
          "mx-auto max-w-6xl lg:max-w-none",
          // Same pl-/pr- reasoning as the header above; pb- adds Safari's
          // bottom inset so the last row and "Show more" aren't hidden
          // behind the address bar.
          "pb-[calc(4rem+env(safe-area-inset-bottom))]",
          "pl-[calc(3rem+env(safe-area-inset-left))] pr-[calc(3rem+env(safe-area-inset-right))]",
          "sm:pl-[calc(4rem+env(safe-area-inset-left))] sm:pr-[calc(4rem+env(safe-area-inset-right))]",
        )}
      >
        {status === "loading" && <SkeletonGrid />}

        {status === "error" && (
          <div className="rounded-lg bg-surface-panel px-6 py-10 text-center ring-1 ring-border-default">
            <p className="text-sm text-text-primary">
              Couldn't load the showcase.
            </p>
            <p className="mt-1 text-xs text-text-muted">{errorMessage}</p>
          </div>
        )}

        {isEmpty && (
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
              <div className="mt-6 flex justify-center">
                <Button
                  variant="outline"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? "Loading…" : "Show more"}
                </Button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
