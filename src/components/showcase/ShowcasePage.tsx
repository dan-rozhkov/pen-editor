import { type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { fetchShowcase, type ShowcaseScreen } from "@/lib/showcase";
import { ShowcaseAppCarousel } from "@/components/showcase/ShowcaseAppCarousel";
import { groupScreensByApp } from "@/components/showcase/showcaseApps";

type Status = "loading" | "ready" | "error";

function ShowcaseGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {children}
    </div>
  );
}

function SkeletonGrid() {
  const heights = [320, 320, 320, 320];
  return (
    <div aria-hidden="true">
      <ShowcaseGrid>
        {heights.map((height, i) => (
          <div
            key={i}
            className="animate-pulse rounded-3xl bg-surface-elevated"
            style={{ height }}
          />
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
  // editor owns a fixed viewport. A page taller than the screen is therefore
  // clipped with no way to scroll it — which is what made the grid
  // unscrollable on phones. Scroll inside this container instead of relying on
  // document scroll, rather than loosening the global rule the editor depends
  // on.
  return (
    <div className="h-full overflow-y-auto bg-white">
      <header className="mx-auto max-w-6xl px-12 pt-12 pb-8 sm:px-16 lg:max-w-none">
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

      <main className="mx-auto max-w-6xl px-12 pb-16 sm:px-16 lg:max-w-none">
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
              {apps.map((app) => (
                <ShowcaseAppCarousel key={app.runId} app={app} />
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
