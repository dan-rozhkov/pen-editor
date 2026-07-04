import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { OfflineBanner } from "@/components/pwa/OfflineBanner";

afterEach(() => {
  cleanup();
});

describe("OfflineBanner", () => {
  it("shows the offline message", () => {
    render(<OfflineBanner />);
    expect(
      screen.getByText(
        "Offline. The editor shell is available; AI and backend features are disabled."
      )
    ).toBeTruthy();
  });

  it("does not block pointer events over the editor chrome underneath it", () => {
    render(<OfflineBanner />);
    const banner = screen.getByTestId("offline-banner");
    expect(banner.className).toContain("pointer-events-none");
  });
});
