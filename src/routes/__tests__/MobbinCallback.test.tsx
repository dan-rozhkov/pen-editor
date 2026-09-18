import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import MobbinCallback from "@/routes/MobbinCallback";
import { MOBBIN_OAUTH_MESSAGE_TYPE } from "@/lib/mobbinAuth";

function setLocation(search: string) {
  const url = new URL(window.location.href);
  url.search = search;
  window.history.replaceState(null, "", url.toString());
}

afterEach(() => {
  cleanup();
  setLocation("");
  vi.restoreAllMocks();
});

// Defect: the callback page's only action besides handing the code to its
// opener is `window.close()`, and PostHog is initialized with
// `capture_pageleave: true`, whose own handler records `location.href`
// (query string included) on close — unlike this app's `RouteTracker`, which
// deliberately strips it. Left in the address bar, the one-time OAuth
// `code`/`state` would ship straight into analytics. The fix scrubs the URL
// synchronously during the first render, before the effect ever closes the
// window.
describe("MobbinCallback — scrubs the one-time code/state from the URL", () => {
  it("removes code and state from window.location.search once mounted", () => {
    setLocation("?code=one-time-code&state=abc123");
    Object.defineProperty(window, "opener", { value: { postMessage: vi.fn() }, configurable: true });
    vi.spyOn(window, "close").mockImplementation(() => {});

    render(<MobbinCallback />);

    expect(window.location.search).not.toContain("one-time-code");
    expect(window.location.search).not.toContain("abc123");
    expect(window.location.search).toBe("");
  });

  it("still delivers the scrubbed params to the opener via postMessage before closing", () => {
    setLocation("?code=one-time-code&state=abc123");
    const postMessage = vi.fn();
    Object.defineProperty(window, "opener", { value: { postMessage }, configurable: true });
    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => {});

    render(<MobbinCallback />);

    expect(postMessage).toHaveBeenCalledWith(
      { type: MOBBIN_OAUTH_MESSAGE_TYPE, code: "one-time-code", state: "abc123", error: undefined },
      window.location.origin,
    );
    expect(closeSpy).toHaveBeenCalledTimes(1);
    // The URL must already be clean by the time postMessage/close run.
    expect(window.location.search).toBe("");
  });

  it("leaves the URL alone when there was nothing to scrub", () => {
    setLocation("");
    Object.defineProperty(window, "opener", { value: undefined, configurable: true });

    render(<MobbinCallback />);

    expect(window.location.search).toBe("");
  });
});

// Defect: `error` preferred the machine error code over the human-readable
// description, so a user saw "access_denied" instead of Mobbin's actual
// explanation.
describe("MobbinCallback — prefers error_description over the raw error code", () => {
  it("shows error_description when both are present", () => {
    setLocation("?error=access_denied&error_description=You+declined+the+request");
    Object.defineProperty(window, "opener", { value: undefined, configurable: true });

    const { getByText } = render(<MobbinCallback />);

    expect(getByText(/You declined the request/i)).toBeTruthy();
  });

  it("falls back to the raw error code when no description is sent", () => {
    setLocation("?error=access_denied");
    Object.defineProperty(window, "opener", { value: undefined, configurable: true });

    const { getByText } = render(<MobbinCallback />);

    expect(getByText(/access_denied/i)).toBeTruthy();
  });
});
