import { DeviceMobileIcon, LaptopIcon } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";
import type { ShowcaseCategory, ShowcasePlatform, ShowcaseSort } from "@/lib/showcase";

interface ShowcaseFilterBarProps {
  sort: ShowcaseSort;
  category: string | null;
  categories: ShowcaseCategory[];
  platform: ShowcasePlatform;
  onSortChange: (sort: ShowcaseSort) => void;
  onCategoryChange: (category: string | null) => void;
  onPlatformChange: (platform: ShowcasePlatform) => void;
}

const SORT_OPTIONS: { value: ShowcaseSort; label: string }[] = [
  { value: "popular", label: "Most popular" },
  { value: "latest", label: "Latest" },
];

const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary";

function capitalizeFirst(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// Mobbin's discover header: sort tabs on the left, a vertical divider, then a
// horizontally scrolling row of category chips. On mobile the complete
// control row scrolls together, so the platform toggle and sort tabs aren't
// stranded while only the chips move. Sort is expressed as plain
// buttons with `aria-pressed` rather than a `role="tablist"` — the grid below
// isn't a tabpanel, so a real tab/tabpanel pairing would be a lie about what
// this controls.
export function ShowcaseFilterBar({
  sort,
  category,
  categories,
  platform,
  onSortChange,
  onCategoryChange,
  onPlatformChange,
}: ShowcaseFilterBarProps) {
  return (
    // Mobile uses a single horizontal scroller for every filter control. The
    // explicit vertical clipping avoids the implicit `overflow-y:auto` that
    // follows `overflow-x:auto`; the matching py/-my space keeps underline
    // and focus-ring pixels inside that clip. From `sm` onward the outer row
    // goes back to visible overflow and the categories own their own scroll.
    <div className="scrollbar-none -my-1 flex items-center gap-4 overflow-x-auto overflow-y-hidden overscroll-x-contain py-1 sm:overflow-visible">
      <div className="flex shrink-0 items-center gap-4">
        <div
          role="group"
          aria-label="Platform"
          className="flex rounded-full bg-surface-base p-1"
        >
          {(["mobile", "desktop"] as const).map((option) => {
            const active = platform === option;
            return (
              <button
                key={option}
                type="button"
                aria-label={option === "mobile" ? "Mobile" : "Web"}
                aria-pressed={active}
                onClick={() => onPlatformChange(option)}
                className={cn(
                  "flex items-center justify-center rounded-full px-3 py-1.5 text-sm font-medium transition-colors sm:px-4",
                  FOCUS_RING,
                  active
                    ? "bg-white text-text-primary shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
                    : "text-text-muted hover:text-text-primary",
                )}
              >
                {option === "mobile" ? (
                  <>
                    <DeviceMobileIcon aria-hidden="true" className="size-4 sm:hidden" />
                    <span className="hidden sm:inline">Mobile</span>
                  </>
                ) : (
                  <>
                    <LaptopIcon aria-hidden="true" className="size-4 sm:hidden" />
                    <span className="hidden sm:inline">Web</span>
                  </>
                )}
              </button>
            );
          })}
        </div>
        <div aria-hidden="true" className="h-4 w-px bg-border-default" />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {SORT_OPTIONS.map((option) => {
          const active = option.value === sort;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onSortChange(option.value)}
              className={cn(
                "shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
                FOCUS_RING,
                active
                  ? "border-text-primary bg-transparent text-text-primary"
                  : "border-border-default bg-transparent text-text-muted hover:text-text-primary",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {categories.length > 0 && (
        <>
          <div
            aria-hidden="true"
            className="h-4 w-px shrink-0 bg-border-default"
          />

          <div
            role="group"
            aria-label="Categories"
            // At mobile widths the outer row scrolls all controls as one
            // sequence. From `sm` onward, let only this chip row consume the
            // remaining width and scroll independently.
            className="scrollbar-none flex shrink-0 items-center gap-2 sm:-my-1 sm:min-w-0 sm:flex-1 sm:overflow-x-auto sm:overscroll-x-contain sm:py-1"
          >
            <button
              type="button"
              aria-pressed={category === null}
              onClick={() => onCategoryChange(null)}
              className={cn(
                "shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
                FOCUS_RING,
                category === null
                  ? "border-text-primary bg-transparent text-text-primary"
                  : "border-border-default bg-transparent text-text-muted hover:text-text-primary",
              )}
            >
              All
            </button>
            {categories.map((c) => {
              const active = c.theme === category;
              return (
                <button
                  key={c.theme}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onCategoryChange(c.theme)}
                  className={cn(
                    "shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
                    FOCUS_RING,
                    active
                      ? "border-text-primary bg-transparent text-text-primary"
                      : "border-border-default bg-transparent text-text-muted hover:text-text-primary",
                  )}
                >
                  {capitalizeFirst(c.theme)}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
