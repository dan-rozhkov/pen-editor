// Pure window-mounting logic for ShowcaseAppCarousel, split into its own
// module so ShowcaseAppCarousel.tsx only exports the component (fast
// refresh requires component-only files) and so this logic is directly
// unit-testable without spinning up Embla under happy-dom — it never runs
// real layout there, so `selectedIndex` can't be driven through simulated
// DOM interaction in tests (see __tests__/ShowcaseAppCarousel.test.tsx).

// Slides overlap inside the carousel viewport (the fade-slide transition
// keeps neighbors partially visible), so the browser's native
// loading="lazy" never defers them — every slide's <img> is "near" the
// viewport from the start. Mounting only the selected slide plus its
// immediate neighbors is the actual fix: farther slides render as a
// same-sized LQIP-only box until scrolled into range. length<=3 just shows
// everything — a ±1 window over 3 slides is already the whole set, so
// there's no bandwidth win in special-casing it further.
//
// Every app with more than 3 screens is rendered with `loop: true`
// (`hasMultipleScreens` is `length > 1`, and any length in {1,2,3} is
// already handled by the branch below), so once we're past that branch
// there is no non-loop case left — a `loop` parameter would only ever be
// called with `true`.
export function getInitialWindow(length: number, selectedIndex: number): Set<number> {
  if (length <= 3) {
    return new Set(Array.from({ length }, (_, i) => i));
  }
  const prev = (selectedIndex - 1 + length) % length;
  const next = (selectedIndex + 1) % length;
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
