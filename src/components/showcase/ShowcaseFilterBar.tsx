import { useState } from "react";
import { DeviceMobileIcon, LaptopIcon } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";
import type { ShowcaseCategory, ShowcaseSort } from "@/lib/showcase";

interface ShowcaseFilterBarProps {
  sort: ShowcaseSort;
  category: string | null;
  categories: ShowcaseCategory[];
  onSortChange: (sort: ShowcaseSort) => void;
  onCategoryChange: (category: string | null) => void;
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
// horizontally scrolling row of category chips. Sort is expressed as plain
// buttons with `aria-pressed` rather than a `role="tablist"` — the grid below
// isn't a tabpanel, so a real tab/tabpanel pairing would be a lie about what
// this controls.
export function ShowcaseFilterBar({
  sort,
  category,
  categories,
  onSortChange,
  onCategoryChange,
}: ShowcaseFilterBarProps) {
  const [platform, setPlatform] = useState<"ios" | "web">("ios");

  return (
    // Keep overflow visible on this outer row. Setting only `overflow-x`
    // forces the browser to compute `overflow-y: auto`, which creates a tiny
    // vertical scrollbar around the underline/focus-ring space. The category
    // row below owns horizontal scrolling itself. The sort tabs keep their
    // width while the category row scrolls horizontally beside them.
    <div className="flex items-center gap-4">
      <div className="flex shrink-0 items-center gap-4">
        <div
          role="group"
          aria-label="Platform"
          className="flex rounded-full bg-surface-base p-1"
        >
          {(["ios", "web"] as const).map((option) => {
            const active = platform === option;
            return (
              <button
                key={option}
                type="button"
                aria-label={option === "ios" ? "Mobile" : "Web"}
                aria-pressed={active}
                onClick={() => setPlatform(option)}
                className={cn(
                  "flex items-center justify-center rounded-full px-3 py-1.5 text-sm font-medium transition-colors sm:px-4",
                  FOCUS_RING,
                  active
                    ? "bg-white text-text-primary shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
                    : "text-text-muted hover:text-text-primary",
                )}
              >
                {option === "ios" ? (
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

      <div className="-my-1 flex shrink-0 items-center gap-4 py-1">
        {SORT_OPTIONS.map((option) => {
          const active = option.value === sort;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onSortChange(option.value)}
              className={cn(
                "relative shrink-0 px-1 pt-2 pb-1.5 text-sm font-semibold whitespace-nowrap transition-colors",
                FOCUS_RING,
                active ? "text-text-primary" : "text-text-muted hover:text-text-primary",
              )}
            >
              {option.label}
              <span
                aria-hidden="true"
                className={cn(
                  "absolute inset-x-0 -bottom-px h-0.5 rounded-full transition-opacity",
                  active ? "bg-text-primary opacity-100" : "opacity-0",
                )}
              />
            </button>
          );
        })}
      </div>

      {categories.length > 0 && (
        <>
          <div
            aria-hidden="true"
            className="hidden h-4 w-px shrink-0 bg-border-default sm:block"
          />

          <div
            role="group"
            aria-label="Categories"
            // `overflow-x-auto` alone forces the browser to resolve the
            // unset vertical axis to `auto` too (the CSS overflow spec — an
            // explicit scrolling value on one axis pins the other to `auto`
            // if it was `visible`), so this row clips its own focus rings
            // vertically even without an explicit `overflow-hidden`. `py-1
            // -my-1` opens up room for the ring *inside* the clipped box
            // without changing the row's outer height.
            className="scrollbar-none -my-1 flex min-w-0 flex-1 items-center gap-2 overflow-x-auto overscroll-x-contain py-1"
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
