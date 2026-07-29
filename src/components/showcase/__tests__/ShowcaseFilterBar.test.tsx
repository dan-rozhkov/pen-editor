import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ShowcaseFilterBar } from "@/components/showcase/ShowcaseFilterBar";
import type { ShowcaseCategory } from "@/lib/showcase";

afterEach(() => {
  cleanup();
});

const categories: ShowcaseCategory[] = [
  { theme: "mobile banking", apps: 5 },
  { theme: "fitness tracker", apps: 3 },
];

describe("<ShowcaseFilterBar />", () => {
  it("renders sort tabs and marks the active one", () => {
    render(
      <ShowcaseFilterBar
        sort="popular"
        category={null}
        categories={categories}
        onSortChange={() => {}}
        onCategoryChange={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Most popular" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Latest" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    const sortRow = screen.getByRole("button", { name: "Latest" }).parentElement;
    const filterBar = sortRow?.parentElement;

    expect(sortRow?.classList.contains("shrink-0")).toBe(true);
    expect(filterBar?.classList.contains("overflow-x-auto")).toBe(true);
    expect(filterBar?.classList.contains("sm:overflow-visible")).toBe(true);
    const categoryRow = screen.getByRole("group", { name: "Categories" });
    expect(categoryRow.classList.contains("overflow-x-auto")).toBe(false);
    expect(categoryRow.classList.contains("scrollbar-none")).toBe(true);
    expect(categoryRow.classList.contains("sm:overflow-x-auto")).toBe(true);
    expect(screen.getByRole("button", { name: "Most popular" }).classList.contains("rounded-full")).toBe(
      true,
    );
    expect(screen.getByRole("button", { name: "Most popular" }).classList.contains("border-text-primary")).toBe(
      true,
    );
    expect(screen.getByRole("button", { name: "Latest" }).classList.contains("border-border-default")).toBe(
      true,
    );
    expect(screen.getByRole("button", { name: "All" }).classList.contains("text-sm")).toBe(
      true,
    );
  });

  it("calls onSortChange with the clicked tab's value", () => {
    const onSortChange = vi.fn();
    render(
      <ShowcaseFilterBar
        sort="popular"
        category={null}
        categories={categories}
        onSortChange={onSortChange}
        onCategoryChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Latest" }));
    expect(onSortChange).toHaveBeenCalledWith("latest");
  });

  it("renders All first, then categories in the given order, All active by default", () => {
    render(
      <ShowcaseFilterBar
        sort="popular"
        category={null}
        categories={categories}
        onSortChange={() => {}}
        onCategoryChange={() => {}}
      />,
    );

    const chips = screen.getAllByRole("button").map((b) => b.textContent);
    expect(chips).toEqual([
      "Mobile",
      "Web",
      "Most popular",
      "Latest",
      "All",
      "Mobile banking",
      "Fitness tracker",
    ]);
    const allChip = screen.getByRole("button", { name: "All" });
    expect(allChip.getAttribute("aria-pressed")).toBe("true");
    expect(allChip.classList.contains("border-text-primary")).toBe(true);
    expect(allChip.classList.contains("bg-transparent")).toBe(true);
  });

  it("switches the platform control's active appearance without filtering the feed", () => {
    render(
      <ShowcaseFilterBar
        sort="popular"
        category={null}
        categories={categories}
        onSortChange={() => {}}
        onCategoryChange={() => {}}
      />,
    );

    const mobile = screen.getByRole("button", { name: "Mobile" });
    const web = screen.getByRole("button", { name: "Web" });
    expect(mobile.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(web);

    expect(mobile.getAttribute("aria-pressed")).toBe("false");
    expect(web.getAttribute("aria-pressed")).toBe("true");
  });

  it("calls onCategoryChange with the theme when a chip is clicked, and null for All", () => {
    const onCategoryChange = vi.fn();
    render(
      <ShowcaseFilterBar
        sort="popular"
        category={null}
        categories={categories}
        onSortChange={() => {}}
        onCategoryChange={onCategoryChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Fitness tracker" }));
    expect(onCategoryChange).toHaveBeenCalledWith("fitness tracker");

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(onCategoryChange).toHaveBeenCalledWith(null);
  });

  it("marks the matching chip active for a category already selected", () => {
    render(
      <ShowcaseFilterBar
        sort="popular"
        category="fitness tracker"
        categories={categories}
        onSortChange={() => {}}
        onCategoryChange={() => {}}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Fitness tracker" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("does not render the chip row when there are no categories, but keeps the sort tabs", () => {
    render(
      <ShowcaseFilterBar
        sort="popular"
        category={null}
        categories={[]}
        onSortChange={() => {}}
        onCategoryChange={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Most popular" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "All" })).toBeNull();
  });

  it("leaves every chip inactive for a URL category absent from the chip list", () => {
    render(
      <ShowcaseFilterBar
        sort="popular"
        category="retro arcade"
        categories={categories}
        onSortChange={() => {}}
        onCategoryChange={() => {}}
      />,
    );

    for (const name of ["All", "Mobile banking", "Fitness tracker"]) {
      expect(screen.getByRole("button", { name }).getAttribute("aria-pressed")).toBe("false");
    }
  });
});
