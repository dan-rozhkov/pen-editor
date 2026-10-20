/**
 * Suspense fallback for the lazy routes. In the entry bundle, so it imports
 * nothing. The theme class is already on <html> (applyStoredUITheme in
 * main.tsx runs before React mounts), so the surface token matches. The
 * spinner fades in after 300 ms via CSS only, so fast chunk loads never flash it.
 */
export function RouteFallback() {
  return (
    <div role="status" className="fixed inset-0 flex items-center justify-center bg-surface-panel">
      <span aria-hidden className="opacity-0 animate-[route-fallback-in_0.2s_300ms_forwards]">
        <span className="block size-5 animate-spin rounded-full border-2 border-text-disabled border-t-text-muted motion-reduce:animate-none" />
      </span>
      <span className="sr-only">Loading</span>
    </div>
  );
}
