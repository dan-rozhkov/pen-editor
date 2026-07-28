// Pure window-mounting logic for ShowcaseAppCarousel, split into its own
// module so ShowcaseAppCarousel.tsx only exports the component (fast
// refresh requires component-only files) and so this logic is directly
// unit-testable: happy-dom runs no layout, so `selectedIndex` can't be
// driven through simulated DOM interaction in tests (see
// __tests__/ShowcaseAppCarousel.test.tsx).

// Mount only the selected slide plus its immediate neighbours; farther
// slides render as a same-sized LQIP-only box until scrolled into range.
// The neighbours are exactly the ones that peek at the scroller's edges, so
// this window is what is actually on screen. length<=3 just shows
// everything — a ±1 window over 3 slides is already the whole set, so
// there's no bandwidth win in special-casing it further.
//
// The indices clamp rather than wrap: this used to be a looping Embla
// carousel, where index 0's "previous" neighbour was the last slide. A
// native scroll container cannot loop, so at index 0 there is nothing to
// the left and mounting the last slide would just fetch an image nobody
// can see yet.
export function getInitialWindow(length: number, selectedIndex: number): Set<number> {
  if (length <= 3) {
    return new Set(Array.from({ length }, (_, i) => i));
  }
  const prev = Math.max(0, selectedIndex - 1);
  const next = Math.min(length - 1, selectedIndex + 1);
  return new Set([prev, selectedIndex, next]);
}

// Mounting is monotonic: once a slide has entered the loaded window, it
// stays mounted even after scrolling away from it. Unmounting would reset
// ShowcaseCard's `imageLoaded` state, so scrolling back in later would mount
// a brand-new <img> (another decode) while the LQIP has already been
// cleared from view — for a beat the card would read as empty/blurred even
// though the browser has the bytes cached. Returns the same `Set` reference
// when `slidesInView` contributes nothing new, so callers can skip a
// re-render.
export function accumulateWindow(mounted: Set<number>, slidesInView: Set<number>): Set<number> {
  let changed = false;
  const next = new Set(mounted);
  slidesInView.forEach((index) => {
    if (!next.has(index)) {
      next.add(index);
      changed = true;
    }
  });
  return changed ? next : mounted;
}
