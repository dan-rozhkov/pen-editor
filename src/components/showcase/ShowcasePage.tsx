import { useEffect, useState } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { fetchShowcase, type ShowcaseScreen } from "@/lib/showcase";
import { ShowcaseCard } from "@/components/showcase/ShowcaseCard";
import {
  columnOffset,
  distributeIntoColumns,
  useColumnCount,
} from "@/components/showcase/masonry";

type Status = "loading" | "ready" | "error";

/**
 * Columns are laid out by hand rather than with CSS `columns-*`: multi-column
 * fills each column top-to-bottom in turn, so the newest screens ended up
 * stacked down the first column instead of running left→right across the top.
 */
function MasonryGrid({ children }: { children: React.ReactNode[] }) {
  const columnCount = useColumnCount();
  const columns = distributeIntoColumns(children, columnCount);
  return (
    <div className="flex gap-4 items-start">
      {columns.map((items, i) => (
        <div
          key={i}
          className="flex min-w-0 flex-1 flex-col gap-4"
          style={{ marginTop: columnOffset(i) }}
        >
          {items}
        </div>
      ))}
    </div>
  );
}

function SkeletonGrid() {
  // Varying heights so the loading state reads as a masonry grid rather than
  // a uniform table, without needing real image dimensions yet.
  const heights = [220, 320, 260, 380, 240, 300, 210, 340];
  return (
    <div aria-hidden="true">
      <MasonryGrid>
        {heights.map((height, i) => (
          <div
            key={i}
            className="animate-pulse rounded-3xl bg-surface-elevated"
            style={{ height }}
          />
        ))}
      </MasonryGrid>
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

  // index.css locks html/body/#root to height:100% + overflow:hidden so the
  // editor owns a fixed viewport. A page taller than the screen is therefore
  // clipped with no way to scroll it — which is what made the grid
  // unscrollable on phones. Scroll inside this container instead of relying on
  // document scroll, rather than loosening the global rule the editor depends
  // on.
  return (
    <div className="h-full overflow-y-auto bg-white">
      <header className="mx-auto max-w-6xl px-6 pt-12 pb-8 sm:px-8 lg:max-w-none">
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

      <main className="mx-auto max-w-6xl px-6 pb-16 sm:px-8 lg:max-w-none">
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

        {status === "ready" && screens.length > 0 && (
          <>
            <MasonryGrid>
              {screens.map((screen) => (
                <ShowcaseCard key={screen.id} screen={screen} />
              ))}
            </MasonryGrid>

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
