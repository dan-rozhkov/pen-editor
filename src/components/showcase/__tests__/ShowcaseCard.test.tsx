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
    title: "Onboarding flow",
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

// Desktop cards pad by a fraction of the grid cell (`px-[9%]` on the
// carousel), so their card width is the cell scaled by 0.82 rather than the
// cell minus a fixed 2x64px — including below `sm`, where the mobile formula
// still subtracts its constant peek.
const DESKTOP_SHOWCASE_IMAGE_SIZES = [
  "(min-width:1280px) calc((100vw - 160px)/3*0.82)",
  "(min-width:640px) calc((100vw - 144px)/2*0.82)",
  "calc((100vw - 32px)*0.82)",
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

  it("pins the image directly to the card box instead of a nested percentage-height chain", () => {
    render(<ShowcaseCard screen={makeScreen()} onCopyId={() => {}} />);

    const image = screen.getByAltText("Onboarding flow");
    for (const cls of ["absolute", "inset-0", "block", "size-full"]) {
      expect(image.classList.contains(cls)).toBe(true);
    }
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

  it("sizes the card box from the screen's own width/height as a CSS aspect-ratio, portrait or landscape", () => {
    const { container: portrait } = render(
      <ShowcaseCard screen={makeScreen({ width: 750, height: 1624 })} onCopyId={() => {}} />,
    );
    const portraitCard = portrait.querySelector('[data-slot="showcase-card"]') as HTMLElement;
    expect(portraitCard.style.aspectRatio).toBe("750 / 1624");

    cleanup();

    const { container: landscape } = render(
      <ShowcaseCard
        screen={makeScreen({ width: 2880, height: 2048 })}
        onCopyId={() => {}}
      />,
    );
    const landscapeCard = landscape.querySelector('[data-slot="showcase-card"]') as HTMLElement;
    expect(landscapeCard.style.aspectRatio).toBe("2880 / 2048");
  });

  it("falls back to the baseline mobile portrait ratio when width/height are absent or zero", () => {
    const { container } = render(
      <ShowcaseCard
        screen={makeScreen({ width: 0, height: 0 })}
        onCopyId={() => {}}
      />,
    );
    const card = container.querySelector('[data-slot="showcase-card"]') as HTMLElement;
    expect(card.style.aspectRatio).toBe("390 / 844");
  });

  it("uses coverWidth/coverHeight for the box aspect ratio instead of the screen's own dimensions when given", () => {
    // Regression test: screens within one app share a fixed capture width but
    // a floating captured height (the backend fits the viewport to each
    // screen's actual body height) — sizing the box off the screen's own
    // height made a carousel's height visibly jump between slides.
    const { container } = render(
      <ShowcaseCard
        screen={makeScreen({ width: 780, height: 2200 })}
        onCopyId={() => {}}
        coverWidth={780}
        coverHeight={1688}
      />,
    );
    const card = container.querySelector('[data-slot="showcase-card"]') as HTMLElement;
    expect(card.style.aspectRatio).toBe("780 / 1688");
  });

  it("falls back to the screen's own width/height when coverWidth/coverHeight are absent", () => {
    const { container } = render(
      <ShowcaseCard screen={makeScreen({ width: 2880, height: 2048 })} onCopyId={() => {}} />,
    );
    const card = container.querySelector('[data-slot="showcase-card"]') as HTMLElement;
    expect(card.style.aspectRatio).toBe("2880 / 2048");
  });

  it("falls back to the baseline mobile ratio when coverWidth/coverHeight are zero, even though the screen has real dimensions", () => {
    const { container } = render(
      <ShowcaseCard
        screen={makeScreen({ width: 750, height: 1624 })}
        onCopyId={() => {}}
        coverWidth={0}
        coverHeight={0}
      />,
    );
    const card = container.querySelector('[data-slot="showcase-card"]') as HTMLElement;
    expect(card.style.aspectRatio).toBe("390 / 844");
  });

  it("gives a 780x1688 cover (hand-authored runs) the same numeric ratio as the legacy 390/844 baseline", () => {
    const { container } = render(
      <ShowcaseCard
        screen={makeScreen({ width: 780, height: 1688 })}
        onCopyId={() => {}}
        coverWidth={780}
        coverHeight={1688}
      />,
    );
    const card = container.querySelector('[data-slot="showcase-card"]') as HTMLElement;
    expect(card.style.aspectRatio).toBe("780 / 1688");
    expect(780 / 1688).toBeCloseTo(390 / 844, 10);
  });

  it("derives the sizes formula (portrait vs landscape) from coverWidth/coverHeight rather than the screen's own dimensions", () => {
    // A portrait screen inside a landscape (desktop) app's carousel must still
    // pick the desktop sizes formula, since layout is governed by the cover.
    render(
      <ShowcaseCard
        screen={makeScreen({
          width: 390,
          height: 844,
          imageUrl1x: "https://example.com/screen-a@1x.webp",
        })}
        onCopyId={() => {}}
        coverWidth={2880}
        coverHeight={2048}
      />,
    );

    const image = screen.getByAltText("Onboarding flow");
    expect(image.getAttribute("sizes")).toBe(DESKTOP_SHOWCASE_IMAGE_SIZES);
  });

  it("picks the landscape (desktop) sizes formula for a landscape screen, and the portrait one otherwise", () => {
    const { rerender } = render(
      <ShowcaseCard
        screen={makeScreen({
          width: 2880,
          height: 2048,
          imageUrl1x: "https://example.com/screen-a@1x.webp",
        })}
        onCopyId={() => {}}
      />,
    );

    let image = screen.getByAltText("Onboarding flow");
    expect(image.getAttribute("sizes")).toBe(DESKTOP_SHOWCASE_IMAGE_SIZES);

    rerender(
      <ShowcaseCard
        screen={makeScreen({
          width: 750,
          height: 1624,
          imageUrl1x: "https://example.com/screen-a@1x.webp",
        })}
        onCopyId={() => {}}
      />,
    );

    image = screen.getByAltText("Onboarding flow");
    expect(image.getAttribute("sizes")).toBe(SHOWCASE_IMAGE_SIZES);
  });
});
