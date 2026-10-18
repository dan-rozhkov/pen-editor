import { useLayoutEffect } from "react";

/** Adds `name` to <html> while the calling route is mounted and removes it on
 * unmount (route-scoped CSS in index.css, e.g. `html.route-agent`). */
export function useHtmlRouteClass(name: string): void {
  useLayoutEffect(() => {
    const html = document.documentElement;
    html.classList.add(name);
    return () => html.classList.remove(name);
  }, [name]);
}
