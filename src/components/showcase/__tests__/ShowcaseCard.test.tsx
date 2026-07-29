import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ShowcaseCard } from "@/components/showcase/ShowcaseCard";
import { useShowcaseOverlayStore } from "@/store/showcaseOverlayStore";
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
  useShowcaseOverlayStore.setState({ openScreenId: null });
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

describe("<ShowcaseCard /> hover/tap overlay (FIR-62)", () => {
  it("renders both overlay buttons with the required English captions", () => {
    render(<ShowcaseCard screen={makeScreen()} onCopyId={() => {}} />);
    expect(screen.getByText("Open in Editor")).toBeTruthy();
    expect(screen.getByText("Copy Screen ID")).toBeTruthy();
  });

  it("calls onCopyId (not onOpenInEditor) when Copy Screen ID is clicked", () => {
    const onCopyId = vi.fn();
    const onOpenInEditor = vi.fn();
    render(
      <ShowcaseCard screen={makeScreen()} onCopyId={onCopyId} onOpenInEditor={onOpenInEditor} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy screen id: Onboarding flow" }));

    expect(onCopyId).toHaveBeenCalledWith(makeScreen());
    expect(onOpenInEditor).not.toHaveBeenCalled();
  });

  it("calls onOpenInEditor (not onCopyId) when Open in Editor is clicked", () => {
    const onCopyId = vi.fn();
    const onOpenInEditor = vi.fn();
    render(
      <ShowcaseCard screen={makeScreen()} onCopyId={onCopyId} onOpenInEditor={onOpenInEditor} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Onboarding flow in the editor" }));

    expect(onOpenInEditor).toHaveBeenCalledWith(makeScreen());
    expect(onCopyId).not.toHaveBeenCalled();
  });

  it("clicking the card itself no longer copies the screen id", () => {
    const onCopyId = vi.fn();
    render(<ShowcaseCard screen={makeScreen()} onCopyId={onCopyId} />);

    fireEvent.click(screen.getByRole("button", { name: "Show actions for Onboarding flow" }));

    expect(onCopyId).not.toHaveBeenCalled();
  });

  it("a tap on the card toggles the shared overlay-open state for this screen, and clears it again", () => {
    render(<ShowcaseCard screen={makeScreen({ id: "screen-a" })} onCopyId={() => {}} />);
    const cardButton = screen.getByRole("button", { name: "Show actions for Onboarding flow" });

    expect(useShowcaseOverlayStore.getState().openScreenId).toBeNull();
    fireEvent.click(cardButton);
    expect(useShowcaseOverlayStore.getState().openScreenId).toBe("screen-a");
    expect(cardButton.getAttribute("aria-expanded")).toBe("true");
  });

  it("opening a different screen's overlay closes this one (at most one open across the showcase)", () => {
    useShowcaseOverlayStore.setState({ openScreenId: "some-other-screen" });
    render(<ShowcaseCard screen={makeScreen({ id: "screen-a" })} onCopyId={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Show actions for Onboarding flow" }));

    expect(useShowcaseOverlayStore.getState().openScreenId).toBe("screen-a");
  });

  it("clicking Open in Editor closes the overlay without needing a second tap", () => {
    useShowcaseOverlayStore.setState({ openScreenId: "screen-a" });
    render(
      <ShowcaseCard
        screen={makeScreen({ id: "screen-a" })}
        onCopyId={() => {}}
        onOpenInEditor={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Onboarding flow in the editor" }));

    expect(useShowcaseOverlayStore.getState().openScreenId).toBeNull();
  });

  // Regression coverage for the review finding: the overlay div is a DOM
  // sibling painted AFTER the toggle button and becomes `pointer-events-auto`
  // once open, so it physically sits on top of that button — a naive test
  // that fires `click` straight at the (now-covered, but still present in the
  // DOM) toggle button would pass even if the overlay itself had no dismiss
  // handler at all. These tests click the actual topmost element instead, the
  // same node a real tap/click would hit.
  it("a second tap that lands on the overlay background (not a button) closes it, on a touch device", () => {
    useShowcaseOverlayStore.setState({ openScreenId: "screen-a" });
    const { container } = render(
      <ShowcaseCard screen={makeScreen({ id: "screen-a" })} onCopyId={() => {}} />,
    );

    // The overlay background is the div that hosts the two action buttons —
    // find it by walking up from one of them, then click it directly rather
    // than the (now-covered) toggle button underneath.
    const overlayBackground = screen.getByText("Open in Editor").parentElement!;
    fireEvent.click(overlayBackground);

    expect(useShowcaseOverlayStore.getState().openScreenId).toBeNull();
    // Sanity: this really is the overlay div, not one of the action buttons.
    expect(overlayBackground.tagName).toBe("DIV");
    const card = container.querySelector('[data-slot="showcase-card"]');
    expect(card?.contains(overlayBackground)).toBe(true);
  });

  it("clicking the overlay background does NOT also fire the covered action buttons' handlers", () => {
    useShowcaseOverlayStore.setState({ openScreenId: "screen-a" });
    const onCopyId = vi.fn();
    const onOpenInEditor = vi.fn();
    render(
      <ShowcaseCard
        screen={makeScreen({ id: "screen-a" })}
        onCopyId={onCopyId}
        onOpenInEditor={onOpenInEditor}
      />,
    );

    fireEvent.click(screen.getByText("Open in Editor").parentElement!);

    expect(onCopyId).not.toHaveBeenCalled();
    expect(onOpenInEditor).not.toHaveBeenCalled();
  });

  it("a click anywhere else on the document closes the open overlay", () => {
    render(<ShowcaseCard screen={makeScreen({ id: "screen-a" })} onCopyId={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Show actions for Onboarding flow" }));
    expect(useShowcaseOverlayStore.getState().openScreenId).toBe("screen-a");

    fireEvent.click(document.body);

    expect(useShowcaseOverlayStore.getState().openScreenId).toBeNull();
  });

  it("Escape closes the open overlay", () => {
    render(<ShowcaseCard screen={makeScreen({ id: "screen-a" })} onCopyId={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Show actions for Onboarding flow" }));
    expect(useShowcaseOverlayStore.getState().openScreenId).toBe("screen-a");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(useShowcaseOverlayStore.getState().openScreenId).toBeNull();
  });

  it("does not close on outside click/Escape once the overlay is already closed (no stray global listeners)", () => {
    render(<ShowcaseCard screen={makeScreen({ id: "screen-a" })} onCopyId={() => {}} />);
    // Never opened — outside click/Escape must be harmless no-ops, not throw.
    expect(() => fireEvent.click(document.body)).not.toThrow();
    expect(() => fireEvent.keyDown(document, { key: "Escape" })).not.toThrow();
    expect(useShowcaseOverlayStore.getState().openScreenId).toBeNull();
  });

  it("an outside click does not clobber a different card's overlay that opened in the same tick", () => {
    // Regression for the ordering hazard: this card's dismiss listener must
    // re-check the store at fire time, not assume it still owns the open
    // state just because it did when the listener was registered.
    render(<ShowcaseCard screen={makeScreen({ id: "screen-a" })} onCopyId={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Show actions for Onboarding flow" }));
    expect(useShowcaseOverlayStore.getState().openScreenId).toBe("screen-a");

    // Simulate another card's own toggle claiming the store before this
    // card's document-level listener runs.
    useShowcaseOverlayStore.setState({ openScreenId: "screen-b" });
    fireEvent.click(document.body);

    expect(useShowcaseOverlayStore.getState().openScreenId).toBe("screen-b");
  });
});
