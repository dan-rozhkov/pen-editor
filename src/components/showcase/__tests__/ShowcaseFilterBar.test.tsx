import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ShowcaseFilterBar } from "@/components/showcase/ShowcaseFilterBar";
import type { ShowcaseCategory, ShowcaseModel } from "@/lib/showcase";

afterEach(() => {
  cleanup();
});

const categories: ShowcaseCategory[] = [
  { theme: "mobile banking", apps: 5 },
  { theme: "fitness tracker", apps: 3 },
];

const models: ShowcaseModel[] = [
  { model: "deepseek/deepseek-v4-pro", apps: 12 },
  { model: "openai/gpt-5", apps: 4 },
];

describe("<ShowcaseFilterBar />", () => {
  it("renders sort tabs and marks the active one", () => {
    render(
      <ShowcaseFilterBar
        sort="popular"
        category={null}
        categories={categories}
        platform="mobile"
        model={null}
        models={[]}
        onSortChange={() => {}}
        onCategoryChange={() => {}}
        onPlatformChange={() => {}}
        onModelChange={() => {}}
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
        platform="mobile"
        model={null}
        models={[]}
        onSortChange={onSortChange}
        onCategoryChange={() => {}}
        onPlatformChange={() => {}}
        onModelChange={() => {}}
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
        platform="mobile"
        model={null}
        models={[]}
        onSortChange={() => {}}
        onCategoryChange={() => {}}
        onPlatformChange={() => {}}
        onModelChange={() => {}}
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

  it("is a controlled platform toggle: aria-pressed follows the `platform` prop, and clicking calls onPlatformChange rather than flipping local state", () => {
    const onPlatformChange = vi.fn();
    const { rerender } = render(
      <ShowcaseFilterBar
        sort="popular"
        category={null}
        categories={categories}
        platform="mobile"
        model={null}
        models={[]}
        onSortChange={() => {}}
        onCategoryChange={() => {}}
        onPlatformChange={onPlatformChange}
        onModelChange={() => {}}
      />,
    );

    const mobile = screen.getByRole("button", { name: "Mobile" });
    const web = screen.getByRole("button", { name: "Web" });
    expect(mobile.getAttribute("aria-pressed")).toBe("true");
    expect(web.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(web);

    // Clicking calls the handler with the clicked value...
    expect(onPlatformChange).toHaveBeenCalledWith("desktop");
    // ...but nothing here re-renders the component, so a purely-local
    // useState would have already flipped `aria-pressed` by now. This bar
    // has none: it stays showing whatever `platform` prop it was given
    // until the owner (ShowcasePage) re-renders it with a new one.
    expect(mobile.getAttribute("aria-pressed")).toBe("true");
    expect(web.getAttribute("aria-pressed")).toBe("false");

    rerender(
      <ShowcaseFilterBar
        sort="popular"
        category={null}
        categories={categories}
        platform="desktop"
        model={null}
        models={[]}
        onSortChange={() => {}}
        onCategoryChange={() => {}}
        onPlatformChange={onPlatformChange}
        onModelChange={() => {}}
      />,
    );

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
        platform="mobile"
        model={null}
        models={[]}
        onSortChange={() => {}}
        onCategoryChange={onCategoryChange}
        onPlatformChange={() => {}}
        onModelChange={() => {}}
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
        platform="mobile"
        model={null}
        models={[]}
        onSortChange={() => {}}
        onCategoryChange={() => {}}
        onPlatformChange={() => {}}
        onModelChange={() => {}}
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
        platform="mobile"
        model={null}
        models={[]}
        onSortChange={() => {}}
        onCategoryChange={() => {}}
        onPlatformChange={() => {}}
        onModelChange={() => {}}
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
        platform="mobile"
        model={null}
        models={[]}
        onSortChange={() => {}}
        onCategoryChange={() => {}}
        onPlatformChange={() => {}}
        onModelChange={() => {}}
      />,
    );

    for (const name of ["All", "Mobile banking", "Fitness tracker"]) {
      expect(screen.getByRole("button", { name }).getAttribute("aria-pressed")).toBe("false");
    }
  });

  it("renders a controlled model select with 'All models' plus a label-only option per model", () => {
    const onModelChange = vi.fn();
    const { rerender } = render(
      <ShowcaseFilterBar
        sort="popular"
        category={null}
        categories={categories}
        platform="mobile"
        model={null}
        models={models}
        onSortChange={() => {}}
        onCategoryChange={() => {}}
        onPlatformChange={() => {}}
        onModelChange={onModelChange}
      />,
    );

    const select = screen.getByRole("combobox", { name: "Model" }) as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(select.classList.contains("[field-sizing:content]")).toBe(true);
    expect(select.classList.contains("max-w-[200px]")).toBe(true);
    expect(select.classList.contains("truncate")).toBe(true);
    expect(select.classList.contains("focus-visible:outline-1")).toBe(true);
    expect(select.classList.contains("focus-visible:outline-text-primary")).toBe(true);
    expect(select.classList.contains("focus-visible:outline-accent-primary")).toBe(false);
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(options[0]).toBe("All models");
    expect(options).toContain("DeepSeek V4 Pro");
    expect(options).not.toContain("DeepSeek V4 Pro (12)");

    fireEvent.change(select, { target: { value: "deepseek/deepseek-v4-pro" } });

    // Selecting an option calls onModelChange...
    expect(onModelChange).toHaveBeenCalledWith("deepseek/deepseek-v4-pro");

    // ...but the select stays controlled: re-rendering with the *same*
    // `model` prop (rather than the value the browser just wrote into the
    // DOM) snaps the select back to it — a purely-local useState wouldn't be
    // corrected by a render that doesn't touch its own state.
    rerender(
      <ShowcaseFilterBar
        sort="popular"
        category={null}
        categories={categories}
        platform="mobile"
        model={null}
        models={models}
        onSortChange={() => {}}
        onCategoryChange={() => {}}
        onPlatformChange={() => {}}
        onModelChange={onModelChange}
      />,
    );
    expect(select.value).toBe("");

    rerender(
      <ShowcaseFilterBar
        sort="popular"
        category={null}
        categories={categories}
        platform="mobile"
        model="deepseek/deepseek-v4-pro"
        models={models}
        onSortChange={() => {}}
        onCategoryChange={() => {}}
        onPlatformChange={() => {}}
        onModelChange={onModelChange}
      />,
    );

    expect(select.value).toBe("deepseek/deepseek-v4-pro");
  });

  it("does not render the model select when there are no models", () => {
    render(
      <ShowcaseFilterBar
        sort="popular"
        category={null}
        categories={categories}
        platform="mobile"
        model={null}
        models={[]}
        onSortChange={() => {}}
        onCategoryChange={() => {}}
        onPlatformChange={() => {}}
        onModelChange={() => {}}
      />,
    );

    expect(screen.queryByRole("combobox", { name: "Model" })).toBeNull();
  });

  it("keeps a stale deep-linked model selected and visible even though it's absent from `models`", () => {
    render(
      <ShowcaseFilterBar
        sort="popular"
        category={null}
        categories={categories}
        platform="mobile"
        model="mistral/old-retired-model"
        models={models}
        onSortChange={() => {}}
        onCategoryChange={() => {}}
        onPlatformChange={() => {}}
        onModelChange={() => {}}
      />,
    );

    const select = screen.getByRole("combobox", { name: "Model" }) as HTMLSelectElement;
    expect(select.value).toBe("mistral/old-retired-model");
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toContain("Old Retired Model");
  });

  it("still renders the model select (showing the active model) when `models` is empty but a model filter is set", () => {
    const onModelChange = vi.fn();
    render(
      <ShowcaseFilterBar
        sort="popular"
        category={null}
        categories={categories}
        platform="mobile"
        model="mistral/old-retired-model"
        models={[]}
        onSortChange={() => {}}
        onCategoryChange={() => {}}
        onPlatformChange={() => {}}
        onModelChange={onModelChange}
      />,
    );

    const select = screen.getByRole("combobox", { name: "Model" }) as HTMLSelectElement;
    expect(select.value).toBe("mistral/old-retired-model");

    fireEvent.change(select, { target: { value: "" } });
    expect(onModelChange).toHaveBeenCalledWith(null);
  });
});
