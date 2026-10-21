import { afterEach, describe, expect, it, vi } from "vitest";

import { key, setupKeyDownHandler } from "./keyboardCommandFixtures";

const openSettings = vi.hoisted(() => vi.fn());
vi.mock("@/lib/openSettings", () => ({ openSettings }));

afterEach(() => openSettings.mockClear());

describe("keyboardCommands — Cmd/Ctrl+, opens Settings", () => {
  it("opens once and ignores auto-repeat", () => {
    const { handler } = setupKeyDownHandler();
    const first = key("Comma", { metaKey: true });
    handler(first);
    expect(first.defaultPrevented).toBe(true);
    expect(openSettings).toHaveBeenCalledTimes(1);

    const repeat = key("Comma", { metaKey: true, repeat: true });
    handler(repeat);
    expect(repeat.defaultPrevented).toBe(true);
    expect(openSettings).toHaveBeenCalledTimes(1);
  });
});
