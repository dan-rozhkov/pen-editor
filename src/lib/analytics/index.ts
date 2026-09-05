import { getUserId } from "@/lib/userId";
import type { AnalyticsEventMap } from "./events";

export type { AnalyticsEventMap } from "./events";
export { bucketLength } from "./buckets";

/**
 * Product-analytics layer (PostHog), one module for the whole editor +
 * showcase. NO PII EVER: never send prompt text, document content, file
 * names, node text, or any user-typed string through `track()` — only
 * enums, booleans, counts, and bucketed numbers (see `bucketLength`). New
 * events must be added to `AnalyticsEventMap` in `./events.ts` first —
 * `track()` is typed against it.
 *
 * Fully disabled (a complete no-op, posthog-js never imported, no network)
 * whenever `VITE_POSTHOG_KEY` is unset. When set, `initAnalytics()` lazily
 * `import()`s posthog-js so it's code-split out of the main bundle and only
 * fetched when analytics is actually enabled. Events fired before that
 * import resolves are buffered (capped) and flushed in order once it does.
 */

const MAX_BUFFER = 50;

type PostHogLike = {
  init: (key: string, options: Record<string, unknown>) => void;
  capture: (event: string, props?: Record<string, unknown>) => void;
};

type ModuleState = {
  /** Set once initAnalytics() has been called with a key present. */
  enabled: boolean;
  /** The loaded posthog-js client, once the dynamic import resolves. */
  client: PostHogLike | null;
  /** True once loading has permanently failed (dynamic import rejected). */
  loadFailed: boolean;
  /** Events captured before `client` is ready. */
  buffer: Array<{ event: string; props: Record<string, unknown> }>;
  /** Guards against initAnalytics() re-running its import on repeat calls. */
  initPromise: Promise<void> | null;
};

function freshState(): ModuleState {
  return {
    enabled: false,
    client: null,
    loadFailed: false,
    buffer: [],
    initPromise: null,
  };
}

let state = freshState();

function readKey(): string | undefined {
  const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
  return key && key.length > 0 ? key : undefined;
}

// The default is the EU cloud because that is where this project's PostHog
// instance lives, and a region mismatch fails SILENTLY: the wrong region's
// ingest endpoint answers 200 to an unknown key and drops the event. A
// deployment on the US cloud must set VITE_POSTHOG_HOST explicitly.
function readHost(): string {
  return (
    (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ||
    "https://eu.i.posthog.com"
  );
}

/**
 * Enables analytics (if `VITE_POSTHOG_KEY` is set) and kicks off the lazy
 * posthog-js load. Safe to call multiple times — later calls are no-ops
 * once loading has started. Never throws.
 */
export function initAnalytics(): void {
  const key = readKey();
  if (!key) return;

  state.enabled = true;
  if (state.initPromise) return;

  state.initPromise = import("posthog-js")
    .then((mod) => {
      const client = (mod.default ?? mod) as unknown as PostHogLike;
      client.init(key, {
        api_host: readHost(),
        person_profiles: "identified_only",
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: true,
        disable_session_recording: true,
        // Keep posthog-js from injecting <script> tags for its remote
        // config/extension bundles (eu-assets.i.posthog.com/array/<key>/config.js
        // and the recorder/surveys/toolbar bundles). Without this the app's
        // Content-Security-Policy would have to carry a third-party origin in
        // `script-src` — the one directive that must stay 'self' — to let an
        // external party ship executable code into the page that owns the
        // user's whole document. Nothing we use needs those bundles: session
        // recording, autocapture, surveys and the toolbar are all off, and
        // feature flags/config still resolve over the normal API host. See
        // docs/csp.md.
        disable_external_dependency_loading: true,
        // Reuse the existing anonymous id (src/lib/userId.ts) so the
        // frontend and backend agree on the same person, without upgrading
        // this to an "identified" (billed) profile.
        bootstrap: { distinctID: getUserId() },
      });
      state.client = client;
      const buffered = state.buffer;
      state.buffer = [];
      for (const { event, props } of buffered) {
        // Each capture is wrapped individually: a client that loaded fine
        // but throws on one buffered event (blocked storage, an extension
        // shimming XHR, a quota error, …) must not fall into the `.catch()`
        // below and get treated as an import failure — that would
        // permanently mark a successfully-loaded client as failed and
        // silently no-op every later track() for the rest of the page's
        // life, over one bad event.
        try {
          client.capture(event, props);
        } catch {
          // Never let one bad buffered event break the rest of the flush.
        }
      }
    })
    .catch(() => {
      // Dynamic import rejected (offline, ad-blocker, stale chunk after a
      // deploy, …) — degrade to a permanent no-op rather than retrying and
      // rather than letting the rejection escape as an unhandled promise.
      // Only a genuine import/init failure should reach this branch — the
      // flush loop above catches capture-time errors on its own so they
      // never bubble up here.
      state.loadFailed = true;
      state.client = null;
      state.buffer = [];
    });
}

/**
 * Records one typed event. Never throws, never touches the network when
 * disabled, and swallows any error from the underlying client so analytics
 * can never break a user action.
 */
export function track<E extends keyof AnalyticsEventMap>(
  event: E,
  props: AnalyticsEventMap[E]
): void {
  try {
    if (!state.enabled || state.loadFailed) return;
    if (state.client) {
      state.client.capture(event as string, props as Record<string, unknown>);
      return;
    }
    state.buffer.push({ event: event as string, props: props as Record<string, unknown> });
    if (state.buffer.length > MAX_BUFFER) {
      state.buffer.shift();
    }
  } catch {
    // Never let analytics break the caller.
  }
}

/** True once `initAnalytics()` has been called with a key present. */
export function isAnalyticsEnabled(): boolean {
  return state.enabled && !state.loadFailed;
}

/**
 * Captures a PostHog `$pageview` for the given pathname. Exported instead of
 * the posthog client itself so nothing outside this module ever touches the
 * raw instance. Pathname only — never query strings, which may carry ids we
 * don't want to record.
 *
 * `$current_url` is a PostHog-reserved property PostHog treats as an
 * ABSOLUTE url (it derives host/path Web Analytics reporting from it), so a
 * bare pathname like "/app" produces a malformed origin and breaks those
 * reports — `window.location.origin` is prefixed on top of `pathname` (the
 * part that intentionally excludes the query string) to keep it well-formed.
 */
export function capturePageview(pathname: string): void {
  try {
    if (!state.enabled || state.loadFailed) return;
    const origin =
      typeof window !== "undefined" && window.location ? window.location.origin : "";
    const currentUrl = `${origin}${pathname}`;
    if (state.client) {
      state.client.capture("$pageview", { $current_url: currentUrl });
      return;
    }
    state.buffer.push({ event: "$pageview", props: { $current_url: currentUrl } });
    if (state.buffer.length > MAX_BUFFER) {
      state.buffer.shift();
    }
  } catch {
    // Never let analytics break navigation.
  }
}

/** Resets all internal module state. Test-only. */
export function __resetAnalyticsForTests(): void {
  state = freshState();
}
