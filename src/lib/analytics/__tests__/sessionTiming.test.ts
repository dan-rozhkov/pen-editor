import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetSessionTimingForTests,
  consumeFirstPromptTiming,
  markEditorOpened,
} from "../sessionTiming";

beforeEach(() => {
  __resetSessionTimingForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sessionTiming", () => {
  it("reports elapsed ms since the most recent markEditorOpened() call", () => {
    let now = 1_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);

    markEditorOpened();
    now = 1_500;

    const { msSinceOpen, isFirst } = consumeFirstPromptTiming();
    expect(msSinceOpen).toBe(500);
    expect(isFirst).toBe(true);
  });

  it("resets the clock on every markEditorOpened() call, not just the first (editor_opened fires on every App mount)", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);

    // First "session": open the editor, browse away for a long time...
    markEditorOpened();
    now = 600_000;

    // ...then come back — a second `editor_opened`/App mount — and send the
    // first prompt only a few seconds into THIS session.
    markEditorOpened();
    now = 600_000 + 3_000;

    const { msSinceOpen } = consumeFirstPromptTiming();
    // Must reflect the few seconds since the second markEditorOpened(), not
    // the ~600000ms since the first.
    expect(msSinceOpen).toBe(3_000);
  });

  it("still fires first_prompt_sent (isFirst) at most once per page load even though the clock resets", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);

    markEditorOpened();
    now = 1_000;
    expect(consumeFirstPromptTiming().isFirst).toBe(true);

    // A later editor_opened (e.g. after browsing back to the showcase and
    // returning) resets the timer but must not let first_prompt_sent fire
    // again.
    markEditorOpened();
    now = 2_000;
    expect(consumeFirstPromptTiming().isFirst).toBe(false);
  });
});
