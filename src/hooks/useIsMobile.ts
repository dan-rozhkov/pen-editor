import { useSyncExternalStore } from "react";

// Matches Tailwind's default `md` breakpoint: anything below 768px is "mobile".
const QUERY = "(max-width: 767px)";

function subscribe(callback: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getSnapshot() {
  return window.matchMedia(QUERY).matches;
}

/** Non-React twin of `useIsMobile` (same query, same answer). */
export function isMobileViewport(): boolean {
  return getSnapshot();
}

/** True when the viewport is narrower than the `md` breakpoint. */
export function useIsMobile() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
