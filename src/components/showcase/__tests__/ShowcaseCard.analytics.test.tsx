import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// Module-mock pattern mirrors src/lib/__tests__/bridgeBootstrap.test.ts.
const { trackMock } = vi.hoisted(() => ({ trackMock: vi.fn() }));
vi.mock("@/lib/analytics", () => ({
  track: trackMock,
}));

import { ShowcaseCard } from "@/components/showcase/ShowcaseCard";
import { __resetShowcaseAppOpenTrackingForTests } from "@/lib/showcaseAppOpenTracking";
import { useShowcaseOverlayStore } from "@/store/showcaseOverlayStore";
import type { ShowcaseScreen } from "@/lib/showcase";

function makeScreen(overrides: Partial<ShowcaseScreen> = {}): ShowcaseScreen {
  return {
    id: "screen-a",
    title: "Onboarding flow",
    imageUrl: "https://example.com/screen-a.webp",
    htmlUrl: "https://example.com/screen-a.html",
    width: 750,
    height: 1624,
    createdAt: "2026-07-28T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  trackMock.mockClear();
  useShowcaseOverlayStore.setState({ openScreenId: null });
  __resetShowcaseAppOpenTrackingForTests();
});

describe("<ShowcaseCard /> showcase_app_opened", () => {
  it("fires once when a card's overlay is opened", () => {
    const screenA = makeScreen({ id: "screen-a" });
    render(
      <ShowcaseCard
        screen={screenA}
        onCopyId={() => {}}
        appId="run-1"
        feedPosition={0}
      />,
    );

    fireEvent.click(screen.getByLabelText("Show actions for Onboarding flow"));

    expect(trackMock.mock.calls.filter(([event]) => event === "showcase_app_opened")).toHaveLength(1);
  });

  it("does not double-count when two different screens of the SAME app are each opened in turn", () => {
    const screenA = makeScreen({ id: "screen-a", title: "Screen A" });
    const screenB = makeScreen({ id: "screen-b", title: "Screen B" });

    const { unmount: unmountA } = render(
      <ShowcaseCard screen={screenA} onCopyId={() => {}} appId="run-1" feedPosition={0} />,
    );
    fireEvent.click(screen.getByLabelText("Show actions for Screen A"));
    unmountA();

    render(<ShowcaseCard screen={screenB} onCopyId={() => {}} appId="run-1" feedPosition={0} />);
    // Opening the SAME app's overlay via a different screen's card (as
    // happens across sibling ShowcaseCards in one ShowcaseAppCarousel) must
    // not be credited as a second app open.
    fireEvent.click(screen.getByLabelText("Show actions for Screen B"));

    const calls = trackMock.mock.calls.filter(([event]) => event === "showcase_app_opened");
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({ app_id: "run-1" });
  });

  it("still fires for a DIFFERENT app after a first app was already credited", () => {
    const screenA = makeScreen({ id: "screen-a", title: "Screen A" });
    const screenC = makeScreen({ id: "screen-c", title: "Screen C" });

    const { unmount: unmountA } = render(
      <ShowcaseCard screen={screenA} onCopyId={() => {}} appId="run-1" feedPosition={0} />,
    );
    fireEvent.click(screen.getByLabelText("Show actions for Screen A"));
    unmountA();

    render(<ShowcaseCard screen={screenC} onCopyId={() => {}} appId="run-2" feedPosition={1} />);
    fireEvent.click(screen.getByLabelText("Show actions for Screen C"));

    const calls = trackMock.mock.calls.filter(([event]) => event === "showcase_app_opened");
    expect(calls).toHaveLength(2);
    expect(calls.map(([, props]) => props.app_id)).toEqual(["run-1", "run-2"]);
  });
});
