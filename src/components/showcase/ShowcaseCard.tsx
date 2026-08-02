import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";

import type { ShowcaseScreen } from "@/lib/showcase";
import { useShowcaseOverlayStore } from "@/store/showcaseOverlayStore";
import { cn } from "@/lib/utils";

// "success"/"error" are the "Copy Screen ID" outcomes; "handoff-error" is
// "Open in Editor" failing to even stash its sessionStorage payload (quota
// exceeded, or blocked entirely — e.g. Safari private mode) — a distinct
// message from a failed copy, but the same transient banner mechanism below.
export type ShowcaseCopyFeedback = "success" | "error" | "handoff-error";

// Derived from the actual geometry, not eyeballed vw fractions — those
// undercounted the two *fixed* paddings that dominate at this card size and
// overstated the card by 1.7-2.4x, which was enough to make retina desktop
// fetch the 750w source when the card only ever renders at ~148px there.
//
// - `<main>` (ShowcasePage): `px-4 sm:px-16` → 16px/64px *per side*. Same for
//   both platforms — platform only changes the grid's column count, not
//   this outer padding.
// - `ShowcaseGrid`: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`
//   (mobile apps) or `grid-cols-1 sm:grid-cols-2 xl:grid-cols-3` (desktop
//   apps — landscape screenshots read as thumbnails at 4, or even 3, to a
//   row, so the desktop grid drops a column and skips the `lg` step
//   entirely: 2 columns already spans `sm` through `xl`) with `gap-4` (16px)
//   between cells.
// - `ShowcaseAppCarousel` (the direct parent of `ShowcaseCard`, inside each
//   grid cell): `px-20 sm:px-16` → another 80px/64px *per side* around the
//   image itself for mobile apps. Desktop apps take `px-[9%]` instead — a
//   fraction of the cell, not a constant — so the two platforms no longer
//   share this term (see DESKTOP_SHOWCASE_IMAGE_SIZES below).
//
// card width = (100vw - 2×mainPad - (cols-1)×gap) / cols - 2×carouselPad
//
// Mobile grid (1 / sm:2 / lg:3 / xl:4):
//   xl (>=1280, 4 cols, sm padding 64 both sides):
//     (100vw - 128 - 3×16) / 4 - 128 = (100vw - 176)/4 - 128
//   lg (>=1024, 3 cols, sm padding):
//     (100vw - 128 - 2×16) / 3 - 128 = (100vw - 160)/3 - 128
//   sm (>=640, 2 cols, sm padding):
//     (100vw - 128 - 1×16) / 2 - 128 = (100vw - 144)/2 - 128
//   base (<640, 1 col, 16px main + 80px carousel padding per side, no gap):
//     100vw - 32 - 160 = 100vw - 192
const MOBILE_SHOWCASE_IMAGE_SIZES = [
  "(min-width:1280px) calc((100vw - 176px)/4 - 128px)",
  "(min-width:1024px) calc((100vw - 160px)/3 - 128px)",
  "(min-width:640px) calc((100vw - 144px)/2 - 128px)",
  "calc(100vw - 192px)",
].join(", ");

// Desktop grid (1 / sm:2 / xl:3, no `lg` step — 2 columns already covers
// `sm` through `xl`, so there's nothing for a `min-width:1024px` entry to
// express that the `min-width:640px` one doesn't already cover).
//
// The desktop carousel's own padding is `px-[9%]` rather than a fixed px step
// (see ShowcaseAppCarousel), so here the card is a *fraction* of the cell
// instead of the cell minus a constant: card width = cell × (1 - 2×0.09)
// = cell × 0.82. That also makes the base (<640) entry differ from mobile's,
// which the fixed-padding version could share.
//   xl (>=1280, 3 cols, sm main padding): ((100vw - 160)/3) × 0.82
//   sm (>=640, 2 cols, sm main padding): ((100vw - 144)/2) × 0.82
//   base (<640, 1 col, 16px main padding per side): (100vw - 32) × 0.82
const DESKTOP_SHOWCASE_IMAGE_SIZES = [
  "(min-width:1280px) calc((100vw - 160px)/3*0.82)",
  "(min-width:640px) calc((100vw - 144px)/2*0.82)",
  "calc((100vw - 32px)*0.82)",
].join(", ");

// Corner radius of the screen itself. The mobile card keeps `rounded-3xl`
// (24px) — a phone screenshot reads as a phone. Desktop screenshots in the
// reference are rounded far more lightly: 28px against a 956px-wide screen,
// i.e. ~2.9% of the screen's width. Across the widths a desktop card actually
// renders at (~280px on a phone, ~415px in a 2-column grid, ~480px on a wide
// monitor) that ratio lands between 8 and 14px, so 12px is the fixed value
// that matches it over the common range — a percentage radius would go
// elliptical on a landscape box.
const DESKTOP_SCREEN_RADIUS = "rounded-xl";
const MOBILE_SCREEN_RADIUS = "rounded-3xl";

function resolveScreenRadius(width: number, height: number): string {
  return width > height ? DESKTOP_SCREEN_RADIUS : MOBILE_SCREEN_RADIUS;
}

// ShowcaseCard isn't handed the platform directly — the caller already
// resolves a portrait-vs-landscape shape via `width`/`height` (the app's
// cover screen, passed down by ShowcaseAppCarousel — see `coverWidth`/
// `coverHeight` below), so deriving it from that avoids a redundant prop that
// could drift out of sync with the data it's describing.
function resolveShowcaseImageSizes(width: number, height: number): string {
  return width > height ? DESKTOP_SHOWCASE_IMAGE_SIZES : MOBILE_SHOWCASE_IMAGE_SIZES;
}

// Fallback for a missing (or zero) width/height pair — the baseline mobile
// portrait ratio this card always used before per-screen aspect ratios
// existed.
const FALLBACK_ASPECT_RATIO = "390 / 844";

function resolveAspectRatio(width: number, height: number): string {
  return width && height ? `${width} / ${height}` : FALLBACK_ASPECT_RATIO;
}

interface ShowcaseCardProps {
  screen: ShowcaseScreen;
  /** "Copy Screen ID" in the hover/tap overlay. Owner holds the clipboard logic. */
  onCopyId: (screen: ShowcaseScreen) => void;
  /**
   * "Open in Editor" in the hover/tap overlay. Owner (ShowcaseAppCarousel)
   * always hands this the *app's* full screen list, not just this one —
   * FIR-62 opens every screen of the app on the canvas regardless of which
   * screen's button was clicked. Optional (rather than required) purely so
   * every pre-existing display-only test of this component doesn't have to
   * pass a handler it never exercises.
   */
  onOpenInEditor?: (screen: ShowcaseScreen) => void;
  /** Transient result of the last copy attempt for this specific card. */
  feedback?: ShowcaseCopyFeedback | null;
  /** fetchPriority="high" + loading="eager" for the one above-the-fold card. */
  eager?: boolean;
  /**
   * loading="eager" (without fetchPriority) for the currently-selected slide
   * of a carousel. Deferring is already handled by ShowcaseAppCarousel's own
   * mount window (±1 around the selected index), and a mounted slide is one
   * that is on screen or peeking at the scroller's edge — so `loading="lazy"`
   * on it is a second gate that can only delay the image the viewer is
   * actually looking at. Marking the selected slide eager removes that,
   * while neighbours stay lazy until a swipe makes them selected in turn.
   *
   * (This started life as a workaround for Embla, whose slides overlapped
   * inside an `overflow:hidden` viewport so that every mounted slide read as
   * "near the viewport" and `loading="lazy"` never deferred anything. The
   * scroller is native scroll-snap now and lazy loading works properly, but
   * eager-loading the slide in view is still the right call.)
   */
  selected?: boolean;
  /**
   * Whether to actually mount the <img>. False renders just the same-sized
   * box painted with the LQIP (or nothing, pre-backfill) — used by
   * ShowcaseAppCarousel for slides outside the selected ±1 window, since
   * overlapping carousel slides sit inside the viewport and defeat
   * loading="lazy" on their own.
   */
  loadImage?: boolean;
  /**
   * Aspect ratio is an APP-level property, not a per-screen one: screens in
   * the same app share one captured width (390 for mobile, wider for
   * desktop) but their captured height floats, because the backend fits the
   * screenshot viewport to each screen's actual body height. Using each
   * screen's own dimensions here made the carousel's height visibly jump
   * mid-swipe between screens of the same app.
   *
   * ShowcaseAppCarousel resolves this once per app from the cover screen
   * (`app.screens[0]`, already pinned-first) and passes the pair down to
   * every card in that carousel, so height stays constant while swiping and
   * `object-cover object-top` (below) still crops any screen that's taller
   * than the cover. Grid layout is unaffected: different apps can still take
   * on different aspect ratios.
   *
   * Falls back to this screen's own width/height (and from there to the
   * baseline mobile ratio) when the caller has none to give — e.g. a
   * standalone render in tests.
   */
  coverWidth?: number;
  coverHeight?: number;
}

// The whole screen is a button (FIR-62): clicking/tapping it toggles a
// hover/tap overlay with "Open in Editor" and "Copy Screen ID" — clicking
// the card itself no longer copies the id directly (that moved to its own
// button in the overlay). ShowcaseAppCarousel owns the clipboard call, the
// "Open in Editor" handoff, and the feedback timer; native scroll-snap
// scrolling suppresses the click event on a drag-release on its own, so no
// manual drag-vs-click bookkeeping is needed here. No permanent
// caption/badge is added on purpose: the showcase is a portfolio, the
// screenshots are the content, and `feedback` only renders for ~2s after a
// copy.
// Each card's box takes on the app's cover aspect ratio (`coverWidth`/
// `coverHeight`, see `resolveAspectRatio` above and the prop doc below)
// rather than one baseline phone-screen ratio — mobile and desktop
// screenshots don't share a shape, and different apps can differ too.
// `object-cover object-top` keeps the top of a screen visible and clips its
// overflow at the bottom, so every card within one app's carousel still
// renders at that same constant size even when an individual screen's own
// captured height differs from the cover's.
export function ShowcaseCard({
  screen,
  onCopyId,
  onOpenInEditor,
  feedback,
  eager = false,
  selected = false,
  loadImage = true,
  coverWidth,
  coverHeight,
}: ShowcaseCardProps) {
  // `??`, not `||`: an explicit 0 (a cover screen with missing dimensions)
  // must fall straight through to `resolveAspectRatio`'s own zero-guard
  // rather than silently substituting this screen's own dimensions — only a
  // genuinely absent prop (a standalone render with no carousel) should fall
  // back to the screen's own width/height.
  const layoutWidth = coverWidth ?? screen.width;
  const layoutHeight = coverHeight ?? screen.height;
  const screenRadius = resolveScreenRadius(layoutWidth, layoutHeight);
  const [imageLoaded, setImageLoaded] = useState(false);
  // `onLoad` never fires for an image the browser had already fully decoded
  // before this node was inserted (e.g. a same-URL slide revisited after
  // ShowcaseAppCarousel's monotonic mounting kept it around, or a plain
  // browser-cache hit) — `complete` is already `true` by the time React
  // hands us the node, and no further `load` event follows. The ref
  // callback catches that at mount; `onLoad` still covers the normal
  // not-yet-loaded case.
  const handleImageRef = useCallback((node: HTMLImageElement | null) => {
    if (node?.complete) {
      setImageLoaded(true);
    }
  }, []);
  // Paint the LQIP as long as the real image hasn't finished loading (or
  // isn't being loaded at all) — this is what actually covers Timeweb's
  // multi-second TTFB, since the placeholder ships inline in the feed JSON
  // and paints before any image request even starts.
  const showLqip = !!screen.lqip && (!loadImage || !imageLoaded);

  // Hover (mouse) reveals the overlay purely via CSS (`group-hover/card`,
  // below) — no state needed for that reveal itself. But a *click* while
  // hover-revealed still has to land on something: the overlay div sits on
  // top of the toggle button once `group-hover/card:pointer-events-auto`
  // (or `isOverlayOpen`) kicks in, so it needs its own click handler too —
  // see `handleOverlayBackgroundClick` below. Touch has no hover, so the
  // first tap has to *open* it via JS; `useShowcaseOverlayStore` keeps that
  // state global (not local to this card) so at most one overlay is open
  // across the whole showcase — tapping a different screen's card closes
  // this one. A tap while already open toggles it back off, satisfying
  // "second tap outside the buttons hides it": the action buttons stop
  // propagation, so only a tap that reaches the toggle button or the overlay
  // background ever runs the toggle. Selector compares to this screen's own
  // id (rather than returning the raw `openScreenId`) so a change to some
  // *other* card's open state doesn't re-render every other card too.
  const cardRef = useRef<HTMLDivElement>(null);
  const isOverlayOpen = useShowcaseOverlayStore((s) => s.openScreenId === screen.id);
  const toggleOverlay = useCallback(() => {
    const { openScreenId: current, setOpenScreenId } = useShowcaseOverlayStore.getState();
    setOpenScreenId(current === screen.id ? null : screen.id);
  }, [screen.id]);
  // The overlay background (not the action buttons — they stop propagation)
  // shares the same toggle as the card's own button: on touch it's what a
  // second tap actually hits once the overlay is covering the card, and on
  // desktop it's what a hover-revealed click hits, so a mouse click also
  // gets to flip `isOverlayOpen`/`aria-expanded` instead of being silently
  // swallowed by the overlay sitting on top.
  const handleOverlayBackgroundClick = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation();
      toggleOverlay();
    },
    [toggleOverlay],
  );
  const handleOpenInEditorClick = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation();
      useShowcaseOverlayStore.getState().setOpenScreenId(null);
      onOpenInEditor?.(screen);
    },
    [onOpenInEditor, screen],
  );
  const handleCopyIdClick = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation();
      onCopyId(screen);
    },
    [onCopyId, screen],
  );

  // Global dismiss for the tap-opened overlay: a click anywhere outside this
  // card, or Escape, closes it. Only registered while this screen's overlay
  // is actually open (not on every mount), and guarded against the store's
  // own "at most one open" invariant — if a different card's click has
  // already moved `openScreenId` on to *its* screen by the time this
  // listener runs (it always runs after React's own onClick handlers, since
  // those are attached closer to the root), this must not clobber that
  // card's freshly-opened state back to closed.
  useEffect(() => {
    if (!isOverlayOpen) return;

    const stillThisScreen = () =>
      useShowcaseOverlayStore.getState().openScreenId === screen.id;

    const handleOutsideClick = (event: globalThis.MouseEvent) => {
      if (!stillThisScreen()) return;
      if (cardRef.current && !cardRef.current.contains(event.target as Node)) {
        useShowcaseOverlayStore.getState().setOpenScreenId(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!stillThisScreen()) return;
      useShowcaseOverlayStore.getState().setOpenScreenId(null);
    };

    document.addEventListener("click", handleOutsideClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("click", handleOutsideClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOverlayOpen, screen.id]);

  return (
    <div
      ref={cardRef}
      data-slot="showcase-card"
      // No `border` here: `border` participates in border-box sizing, and
      // WebKit resolves this card's `aspectRatio`-derived `height:100%`
      // chain (button + img) against the border box while Blink resolves it
      // against the content box — so a real 1px border silently made the
      // WebKit content box 2px shorter, pushing the `object-cover object-top`
      // image 2px past the bottom edge where `overflow-hidden` clipped it
      // (visible as a sliced tab bar on real screenshots). The hairline is
      // painted by a separate overlay div below, not as this element's own
      // `inset-ring` — an inset box-shadow paints *under* an element's own
      // children, so a ring here would sit behind the full-bleed screenshot
      // and never be seen once the image loads.
      //
      // The aspect ratio is per-app, from `coverWidth`/`coverHeight` (inline
      // style, not a Tailwind class): mobile apps are ~390/844 portrait,
      // desktop ones are landscape (~2880/2048) — an arbitrary-value Tailwind
      // class can't take a runtime value, so this has to be a real style
      // property.
      className={cn(
        "group/card relative w-full overflow-hidden bg-surface-elevated bg-cover bg-top",
        screenRadius,
      )}
      style={{
        aspectRatio: resolveAspectRatio(layoutWidth, layoutHeight),
        ...(showLqip ? { backgroundImage: `url(${screen.lqip})` } : null),
      }}
    >
      <button
        type="button"
        onClick={toggleOverlay}
        aria-label={`Show actions for ${screen.title}`}
        aria-expanded={isOverlayOpen}
        className="block size-full cursor-pointer"
      >
        {loadImage && (
          <img
            ref={handleImageRef}
            src={screen.imageUrl}
            // Descriptors are built from the real screen dimensions rather
            // than hardcoded 375w/750w: hand-authored runs (showcase-hand-run)
            // publish at 780x1688, not the generated pipeline's 750x1624 —
            // baking in the wrong width would have the browser picking the
            // wrong source by ~4%.
            srcSet={
              screen.imageUrl1x
                ? `${screen.imageUrl1x} ${Math.round(screen.width / 2)}w, ${screen.imageUrl} ${screen.width}w`
                : undefined
            }
            sizes={
              screen.imageUrl1x
                ? resolveShowcaseImageSizes(layoutWidth, layoutHeight)
                : undefined
            }
            alt={screen.title}
            loading={eager || selected ? "eager" : "lazy"}
            fetchPriority={eager ? "high" : undefined}
            onLoad={() => setImageLoaded(true)}
            // Native image drag would otherwise fight the scroller's own
            // pointer gesture.
            draggable={false}
            // Pin the replaced element straight to the positioned card.
            // Keeping it in normal flow made WebKit resolve two nested
            // percentage heights (button → img) at a fractional mobile card
            // height; its compositor could round the image past the card's
            // bottom clip even when layout geometry reported equal boxes.
            // Absolute insets use the card itself as the containing block,
            // while `block` also removes inline-image baseline participation.
            className="absolute inset-0 block size-full object-cover object-top"
          />
        )}
      </button>

      {/* Hairline overlay: painted after the button in DOM order so it sits
          on top of the (opaque, full-bleed) screenshot. `inset-ring-*` here
          is a layout-neutral inset shadow — no border box, so no WebKit/Blink
          divergence — and living outside the card's own box-shadow layer
          means it isn't hidden by the image the way a ring on the card
          itself would be. */}
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 inset-ring-1 inset-ring-border-default",
          screenRadius,
        )}
      />

      {/* Hover/tap action overlay. Hidden by default (`opacity-0
          pointer-events-none`); a hover-capable pointer reveals it via
          `group-hover/card` alone, no state involved. Touch has no hover, so
          `isOverlayOpen` (this screen's tap-toggle state, see above) forces
          it open too — the two conditions are additive, not exclusive, so a
          desktop user who tapped (rather than clicked a button) still sees
          it stay open the same way a touch user would.

          Once either condition makes this div `pointer-events-auto`, it sits
          on top of the toggle button underneath it in DOM order, so it needs
          its own `onClick` (`handleOverlayBackgroundClick`, toggles the same
          store state) rather than relying on that button's handler ever
          firing again — otherwise a second tap (touch) or a click while
          hover-revealed (desktop) would hit this div and silently do
          nothing. The action buttons inside stop propagation, so this only
          fires for a click on the semi-transparent background itself.
          Escape and a click anywhere outside the card (see the `useEffect`
          above) close it the same way. */}
      {/* Not `aria-hidden` when visually hidden: unlike the arrows/dots
          elsewhere on this page, whether this overlay is *visually* shown is
          driven by CSS `:hover`/tap state that React never mirrors into an
          attribute, so there is no boolean here that would track real
          visibility — hiding it from the accessibility tree would make these
          two actions permanently unreachable by keyboard/screen-reader
          users instead of just visually deferred until hover/focus. */}
      <div
        onClick={handleOverlayBackgroundClick}
        className={cn(
          "pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/45 opacity-0 transition-opacity",
          "group-hover/card:pointer-events-auto group-hover/card:opacity-100",
          "focus-within:pointer-events-auto focus-within:opacity-100",
          isOverlayOpen && "pointer-events-auto opacity-100",
          screenRadius,
        )}
      >
        <button
          type="button"
          onClick={handleOpenInEditorClick}
          aria-label={`Open ${screen.title} in the editor`}
          className="rounded-full bg-white px-4 py-2 text-xs font-medium text-black shadow-sm transition-colors hover:bg-white/90"
        >
          Open in Editor
        </button>
        <button
          type="button"
          onClick={handleCopyIdClick}
          aria-label={`Copy screen id: ${screen.title}`}
          className="rounded-full bg-white/15 px-4 py-2 text-xs font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/25"
        >
          Copy Screen ID
        </button>
      </div>

      {feedback && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute inset-x-3 bottom-3 rounded-full bg-surface-active/90 px-3 py-1.5 text-center text-xs font-medium text-text-primary backdrop-blur-sm"
        >
          {feedback === "success"
            ? "ID copied"
            : feedback === "handoff-error"
              ? "Couldn't open in editor"
              : "Couldn't copy"}
        </div>
      )}
    </div>
  );
}
