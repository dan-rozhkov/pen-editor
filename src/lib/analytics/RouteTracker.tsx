import { useEffect } from "react";
import { useLocation } from "react-router";
import { capturePageview } from "./index";

/**
 * Captures a PostHog `$pageview` on every pathname change. Mounted once
 * inside `<BrowserRouter>` in AppRouter.tsx, so it sees both the showcase
 * ("/") and editor ("/app") routes. Pathname only — never the query string,
 * which can carry ids we don't want to record.
 */
export function RouteTracker() {
  const location = useLocation();

  useEffect(() => {
    capturePageview(location.pathname);
  }, [location.pathname]);

  return null;
}
