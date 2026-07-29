import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  consumeShowcaseScreensHandoff,
  storeShowcaseScreensHandoff,
  type ShowcaseScreensHandoff,
} from "@/lib/showcaseScreenHandoff";

const PAYLOAD: ShowcaseScreensHandoff = {
  runId: "run-1",
  screens: [
    { id: "screen-a", title: "Home" },
    { id: "screen-b", title: "Detail" },
  ],
};

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("showcase screens handoff", () => {
  it("stores a payload and consumes it only once", () => {
    expect(storeShowcaseScreensHandoff(PAYLOAD)).toBe(true);
    expect(consumeShowcaseScreensHandoff()).toEqual(PAYLOAD);
    expect(consumeShowcaseScreensHandoff()).toBeNull();
  });

  it("rejects a payload with no screens without changing an existing handoff", () => {
    storeShowcaseScreensHandoff(PAYLOAD);

    expect(storeShowcaseScreensHandoff({ runId: "run-2", screens: [] })).toBe(false);

    expect(consumeShowcaseScreensHandoff()).toEqual(PAYLOAD);
  });

  it("returns null when there is no handoff", () => {
    expect(consumeShowcaseScreensHandoff()).toBeNull();
  });

  it("returns null for malformed JSON instead of throwing", () => {
    sessionStorage.setItem("pen:showcase-editor-screens:v1", "not json");
    expect(consumeShowcaseScreensHandoff()).toBeNull();
    // Still one-shot: the malformed value is cleared on read.
    expect(sessionStorage.getItem("pen:showcase-editor-screens:v1")).toBeNull();
  });

  it("does not throw when web storage is unavailable", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: vi.fn(() => {
        throw new DOMException("Blocked", "SecurityError");
      }),
      removeItem: vi.fn(() => {
        throw new DOMException("Blocked", "SecurityError");
      }),
      setItem: vi.fn(() => {
        throw new DOMException("Blocked", "SecurityError");
      }),
    });

    expect(storeShowcaseScreensHandoff(PAYLOAD)).toBe(false);
    expect(consumeShowcaseScreensHandoff()).toBeNull();
  });
});
