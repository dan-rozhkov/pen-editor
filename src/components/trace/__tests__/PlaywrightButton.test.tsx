import type { BrowseTrace } from "@sideform/browser-agent/agent/session";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleTrace } from "../__fixtures__/sampleTrace";
import { PlaywrightButton } from "../PlaywrightButton";

const withRepro: BrowseTrace = {
  ...sampleTrace,
  repro: { setup: {} },
  steps: sampleTrace.steps.map((s) =>
    s.index === 0 ? { ...s, repro: [{ op: "goto" as const, url: "https://acme.test/" }] } : s,
  ),
};

describe("PlaywrightButton", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("is hidden for a trace recorded without repro", () => {
    render(<PlaywrightButton trace={sampleTrace} />);
    expect(screen.queryByRole("button", { name: "Download Playwright test" })).toBeNull();
  });

  it("downloads the spec file of a trace with repro", async () => {
    let blob: Blob | undefined;
    URL.createObjectURL = vi.fn((b: Blob | MediaSource) => {
      blob = b as Blob;
      return "blob:x";
    });
    URL.revokeObjectURL = vi.fn();
    let name = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      name = this.download;
    });
    render(<PlaywrightButton trace={withRepro} />);
    fireEvent.click(screen.getByRole("button", { name: "Download Playwright test" }));
    expect(name).toMatch(/\.spec\.ts$/);
    expect(await blob!.text()).toContain("https://acme.test/");
  });
});
