// Router paths are relative to Vite's BASE_URL; the auth entry points are plain
// links (not router <Link>s) so they also render outside a Router, e.g. in the
// editor toolbar's unit tests.
export function appHref(path: string): string {
  return `${import.meta.env.BASE_URL.replace(/\/$/, "")}${path}`;
}

/** A browser pathname made router-relative (Vite's BASE_URL removed). */
export function stripBase(pathname: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  if (base && (pathname === base || pathname.startsWith(`${base}/`))) {
    return pathname.slice(base.length) || "/";
  }
  return pathname;
}

/** Router-relative (no basename) sign-in path, for <Navigate>/navigate(). */
export function signInPath(next?: string): string {
  return `/sign-in${next ? `?next=${encodeURIComponent(next)}` : ""}`;
}

export function signInHref(next?: string): string {
  return appHref(signInPath(next));
}
