import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ShowcaseCard } from "@/components/showcase/ShowcaseCard";
import type { ShowcaseScreen } from "@/lib/showcase";

// Covers pen-editor-backend docs/superpowers/specs/2026-07-28-showcase-image-delivery-design.md
// §3 (Frontend): srcset/sizes gated on `imageUrl1x`, and fetchPriority gated
// on `eager` — both feature-detected since older rows lack the derivative
// fields entirely.

function makeScreen(overrides: Partial<ShowcaseScreen> = {}): ShowcaseScreen {
  return {
    id: "screen-a",
    runId: "run-1",
    theme: "dark",
    title: "Onboarding flow",
    model: "test/model",
    imageUrl: "https://example.com/screen-a.webp",
    htmlUrl: "https://example.com/screen-a.html",
    width: 750,
    height: 1624,
    createdAt: "2026-07-28T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const SHOWCASE_IMAGE_SIZES = [
  "(min-width:1280px) calc((100vw - 176px)/4 - 128px)",
  "(min-width:1024px) calc((100vw - 160px)/3 - 128px)",
  "(min-width:640px) calc((100vw - 144px)/2 - 128px)",
  "calc(100vw - 192px)",
].join(", ");

describe("<ShowcaseCard />", () => {
  it("renders srcset/sizes when imageUrl1x is present, with descriptors derived from the real screen width", () => {
    render(
      <ShowcaseCard
        screen={makeScreen({ imageUrl1x: "https://example.com/screen-a@1x.webp" })}
        onCopyId={() => {}}
      />,
    );

    const image = screen.getByAltText("Onboarding flow");
    expect(image.getAttribute("srcset")).toBe(
      "https://example.com/screen-a@1x.webp 375w, https://example.com/screen-a.webp 750w",
    );
    expect(image.getAttribute("sizes")).toBe(SHOWCASE_IMAGE_SIZES);
  });

  it("derives srcset descriptors from screen.width, not a hardcoded 375/750", () => {
    // Hand-authored runs (showcase-hand-run) publish at 780x1688, not the
    // generated pipeline's 750x1624 — a hardcoded descriptor would be ~4%
    // off for these rows.
    render(
      <ShowcaseCard
        screen={makeScreen({
          imageUrl: "https://example.com/screen-a.webp",
          imageUrl1x: "https://example.com/screen-a@1x.webp",
          width: 780,
          height: 1688,
        })}
        onCopyId={() => {}}
      />,
    );

    const image = screen.getByAltText("Onboarding flow");
    expect(image.getAttribute("srcset")).toBe(
      "https://example.com/screen-a@1x.webp 390w, https://example.com/screen-a.webp 780w",
    );
  });

  it("renders a bare src with no srcset/sizes when imageUrl1x is absent", () => {
    render(<ShowcaseCard screen={makeScreen()} onCopyId={() => {}} />);

    const image = screen.getByAltText("Onboarding flow");
    expect(image.getAttribute("src")).toBe("https://example.com/screen-a.webp");
    expect(image.getAttribute("srcset")).toBeNull();
    expect(image.getAttribute("sizes")).toBeNull();
  });

  it("sets fetchPriority=high and loading=eager only when eager is set", () => {
    const { rerender } = render(<ShowcaseCard screen={makeScreen()} onCopyId={() => {}} />);

    let image = screen.getByAltText("Onboarding flow");
    expect(image.getAttribute("fetchpriority")).toBeNull();
    expect(image.getAttribute("loading")).toBe("lazy");

    rerender(<ShowcaseCard screen={makeScreen()} onCopyId={() => {}} eager />);

    image = screen.getByAltText("Onboarding flow");
    expect(image.getAttribute("fetchpriority")).toBe("high");
    expect(image.getAttribute("loading")).toBe("eager");
  });

  it("sets loading=eager without fetchPriority when selected is set (no eager)", () => {
    // Native loading="lazy" never defers a carousel slide (Embla's slides
    // overlap inside an overflow:hidden viewport), so the carousel's
    // currently-selected slide must get loading="eager" regardless of
    // whether it's also the above-the-fold `eager` card — but it must NOT
    // pick up fetchPriority="high", which stays reserved for the single
    // above-the-fold card via `eager`.
    render(<ShowcaseCard screen={makeScreen()} onCopyId={() => {}} selected />);

    const image = screen.getByAltText("Onboarding flow");
    expect(image.getAttribute("loading")).toBe("eager");
    expect(image.getAttribute("fetchpriority")).toBeNull();
  });

  it("paints the lqip as a background and does not mount an <img> when loadImage is false", () => {
    const { container } = render(
      <ShowcaseCard
        screen={makeScreen({ lqip: "data:image/webp;base64,AAAA" })}
        onCopyId={() => {}}
        loadImage={false}
      />,
    );

    expect(screen.queryByAltText("Onboarding flow")).toBeNull();
    const card = container.querySelector('[data-slot="showcase-card"]') as HTMLElement;
    expect(card.style.backgroundImage).toBe('url("data:image/webp;base64,AAAA")');
  });

  it("paints the lqip until the image's onLoad fires, then clears it", () => {
    // happy-dom's <img>.complete defaults to `true` (image loading is
    // disabled in this test environment, so the src-loading path that
    // would normally flip it to `false` never runs) — force it to the
    // real not-yet-loaded state so this test exercises the `onLoad` path
    // rather than the ref-callback's cache-hit shortcut.
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(false);

    const { container } = render(
      <ShowcaseCard
        screen={makeScreen({ lqip: "data:image/webp;base64,AAAA" })}
        onCopyId={() => {}}
      />,
    );

    const card = container.querySelector('[data-slot="showcase-card"]') as HTMLElement;
    expect(card.style.backgroundImage).toBe('url("data:image/webp;base64,AAAA")');

    fireEvent.load(screen.getByAltText("Onboarding flow"));

    expect(card.style.backgroundImage).toBe("");
  });

  it("treats an image already complete at mount (cache hit) as loaded, without waiting for onLoad", () => {
    // Explicit even though happy-dom's `complete` already defaults to
    // `true` here (image loading is disabled in this test environment) —
    // this pins the real-browser cache-hit case: decode finishes before
    // React even commits the node, so no `load` event follows it into the
    // DOM and only the ref callback's `complete` check catches it.
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);

    const { container } = render(
      <ShowcaseCard
        screen={makeScreen({ lqip: "data:image/webp;base64,AAAA" })}
        onCopyId={() => {}}
      />,
    );

    const card = container.querySelector('[data-slot="showcase-card"]') as HTMLElement;
    expect(card.style.backgroundImage).toBe("");
  });
});
