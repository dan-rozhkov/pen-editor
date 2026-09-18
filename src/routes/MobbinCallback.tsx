import { useEffect, useState } from "react";
import { MOBBIN_OAUTH_MESSAGE_TYPE } from "@/lib/mobbinAuth";

// Mounted at /oauth/mobbin/callback (see AppRouter.tsx). Mobbin redirects the
// popup opened by mobbinAuth.connect() here with `code`/`state` (or `error`)
// as query params; this page's only job is to hand those back to the opener
// via postMessage and close itself. It never talks to the backend directly —
// mobbinAuth.ts (running in the opener) does the code exchange.
interface CallbackParams {
  code?: string;
  state?: string;
  error?: string;
}

// Reads the one-time `code`/`state` (or `error`) query params and *wipes them
// from the address bar immediately*, before returning. This must happen
// before React commits or any other module gets a chance to read
// `location.href` — this app's PostHog init sets `capture_pageleave: true`,
// and posthog-js's own pageleave handler records `$current_url =
// location.href` verbatim (unlike this app's own `RouteTracker`, which
// deliberately drops the query string). Since this page's only other action
// is `window.close()`, that pageleave fires right after mount, and — absent
// this — `$pageleave` would ship the one-time OAuth code and state straight
// into analytics. Doing this synchronously in the lazy `useState` initializer
// (i.e. during the first render, not an effect) guarantees it runs before the
// commit-phase effect below ever calls `window.close()`.
function readAndClearCallbackParams(): CallbackParams {
  const params = new URLSearchParams(window.location.search);
  const result: CallbackParams = {
    code: params.get("code") ?? undefined,
    state: params.get("state") ?? undefined,
    // Prefer the human-readable description over the machine error code
    // (e.g. "access_denied") — falls back to the code only when no
    // description was sent.
    error: params.get("error_description") ?? params.get("error") ?? undefined,
  };
  if (window.location.search) {
    window.history.replaceState(null, "", window.location.pathname);
  }
  return result;
}

export default function MobbinCallback() {
  // Read + immediately scrub the URL exactly once, via the lazy initializer
  // — it runs synchronously during the first render, before any effect and
  // before `window.location.search` could be observed by anything else
  // (analytics included). `window.opener` doesn't change while this page is
  // mounted either, so the "no opener" message is computed here too rather
  // than in an effect (an effect that calls setState directly in its body
  // causes an avoidable extra render — react-hooks/set-state-in-effect).
  const [{ params, noOpenerMessage }] = useState<{
    params: CallbackParams;
    noOpenerMessage: string | null;
  }>(() => {
    const parsed = readAndClearCallbackParams();
    const noOpenerMessage = window.opener
      ? null
      : parsed.error
        ? `Mobbin sign-in failed: ${parsed.error}`
        : "This page finishes connecting Mobbin to Pen Editor. It looks like it wasn't opened from there — you can close this tab.";
    return { params: parsed, noOpenerMessage };
  });

  useEffect(() => {
    if (!window.opener) return;
    window.opener.postMessage(
      { type: MOBBIN_OAUTH_MESSAGE_TYPE, ...params },
      window.location.origin,
    );
    window.close();
  }, [params]);

  if (noOpenerMessage) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-panel px-6 text-center text-sm text-text-muted">
        {noOpenerMessage}
      </div>
    );
  }

  return null;
}
