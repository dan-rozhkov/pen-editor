import { DeviceMobileIcon, LaptopIcon } from "@/components/icons";

import { cn } from "@/lib/utils";
import { getShowcaseModelLabel } from "@/components/showcase/showcaseApps";
import type {
  ShowcaseCategory,
  ShowcaseModel,
  ShowcasePlatform,
  ShowcaseSort,
} from "@/lib/showcase";
import { SegmentedGroup, segmentedItemClass } from "@/components/ui/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ShowcaseFilterBarProps {
  sort: ShowcaseSort;
  category: string | null;
  categories: ShowcaseCategory[];
  platform: ShowcasePlatform;
  model: string | null;
  models: ShowcaseModel[];
  onSortChange: (sort: ShowcaseSort) => void;
  onCategoryChange: (category: string | null) => void;
  onPlatformChange: (platform: ShowcasePlatform) => void;
  onModelChange: (model: string | null) => void;
}

const SORT_OPTIONS: { value: ShowcaseSort; label: string }[] = [
  { value: "popular", label: "Most popular" },
  { value: "latest", label: "Latest" },
];

const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary";

// base-ui items cannot reliably use "" as a value; map "all models" to a sentinel.
const ALL_MODELS_VALUE = "__all__";

// The editor's own select (SelectTrigger: panel fill, input border, its focus ring), sized like the
// `lg` buttons next to it: 32px tall with the matching control radius.
const UI_TRIGGER = "shrink-0 data-[size=default]:h-8 rounded-control-lg px-2.5";

const CONTENT_PROPS = {
  align: "start" as const,
  alignItemWithTrigger: false,
  className: "w-max max-w-(--available-width) min-w-(--anchor-width)",
};

function capitalizeFirst(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// On mobile the complete control row scrolls together, so platform, category,
// model, and sort controls remain available in one sequence.
export function ShowcaseFilterBar({
  sort,
  category,
  categories,
  platform,
  model,
  models,
  onSortChange,
  onCategoryChange,
  onPlatformChange,
  onModelChange,
}: ShowcaseFilterBarProps) {
  return (
    // Mobile uses a single horizontal scroller for every filter control. The
    // explicit vertical clipping avoids the implicit `overflow-y:auto` that
    // follows `overflow-x:auto`; the matching py/-my space keeps underline
    // and focus-ring pixels inside that clip. From `sm` onward the outer row
    // goes back to visible overflow and the categories own their own scroll.
    <div className="scrollbar-none -my-1 flex items-center gap-4 overflow-x-auto overflow-y-hidden overscroll-x-contain py-1 sm:overflow-visible">
      <div className="flex shrink-0 items-center">
        {/* The editor's segmented control (SegmentedGroup + segmentedItemClass), 32px tall like the selects. */}
        <SegmentedGroup aria-label="Platform">
          {(["mobile", "desktop"] as const).map((option) => {
            const active = platform === option;
            return (
              <button
                key={option}
                type="button"
                aria-label={option === "mobile" ? "Mobile" : "Web"}
                aria-pressed={active}
                onClick={() => onPlatformChange(option)}
                className={segmentedItemClass(active, {
                  className: "h-[26px] px-1.5 sm:px-2.5 [&_svg]:size-4",
                })}
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
        </SegmentedGroup>
      </div>

      {categories.length > 0 && (
        <>
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

      {(models.length > 0 || model !== null) && (
        <div className="flex shrink-0 items-center">
          <Select
            value={model ?? ALL_MODELS_VALUE}
            onValueChange={(value) =>
              onModelChange(value === null || value === ALL_MODELS_VALUE ? null : value)
            }
          >
            <SelectTrigger aria-label="Model" className={cn(UI_TRIGGER, "max-w-[200px]")}>
              <SelectValue>
                {model === null ? "All models" : getShowcaseModelLabel(model)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent {...CONTENT_PROPS}>
              <SelectItem value={ALL_MODELS_VALUE}>All models</SelectItem>
              {/* A deep-linked/bookmarked `model` can outlive its entry in
                  `models` (e.g. the models list fetch failed, or the model
                  was dropped from GET /api/showcase/models). Without this,
                  the select would have no item matching the active value
                  while the feed stays filtered. */}
              {model !== null && !models.some((m) => m.model === model) && (
                <SelectItem value={model}>{getShowcaseModelLabel(model)}</SelectItem>
              )}
              {models.map((m) => (
                <SelectItem key={m.model} value={m.model}>
                  {getShowcaseModelLabel(m.model)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex shrink-0 items-center">
        <Select
          value={sort}
          onValueChange={(value) => {
            if (value !== null) onSortChange(value as ShowcaseSort);
          }}
        >
          <SelectTrigger aria-label="Sort" className={UI_TRIGGER}>
            <SelectValue>
              {SORT_OPTIONS.find((option) => option.value === sort)?.label ?? sort}
            </SelectValue>
          </SelectTrigger>
          <SelectContent {...CONTENT_PROPS}>
            {SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
