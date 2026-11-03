import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AutoplayVideo } from "@/components/showcase/landing/AutoplayVideo";

type IOCallback = (entries: { isIntersecting: boolean }[]) => void;

interface FakeObserverInstance {
  cb: IOCallback;
  options: IntersectionObserverInit;
  disconnect: ReturnType<typeof vi.fn>;
}

let observers: FakeObserverInstance[] = [];
const play = vi.fn();
const pause = vi.fn();
let motionListeners: (() => void)[] = [];
let reducedNow = false;
let frames: FrameRequestCallback[] = [];

class FakeObserver {
  constructor(cb: IOCallback, options: IntersectionObserverInit = {}) {
    observers.push({ cb, options, disconnect: this.disconnect });
  }
  observe() {}
  disconnect = vi.fn();
}

function stubMatchMedia(reduced: boolean) {
  reducedNow = reduced;
  motionListeners = [];
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        get matches() {
          return reducedNow;
        },
        media: query,
        addEventListener: (_type: string, fn: () => void) => motionListeners.push(fn),
        removeEventListener: (_type: string, fn: () => void) => {
          motionListeners = motionListeners.filter((l) => l !== fn);
        },
      }) as unknown as MediaQueryList,
  );
}

function setReduced(reduced: boolean) {
  reducedNow = reduced;
  act(() => motionListeners.forEach((fn) => fn()));
}

const inViewObserver = () => observers.find((o) => o.options.threshold !== undefined);
const nearObserver = () => observers.find((o) => o.options.rootMargin !== undefined);

function setIntersecting(isIntersecting: boolean) {
  act(() => inViewObserver()?.cb([{ isIntersecting }]));
}

function setNear() {
  act(() => nearObserver()?.cb([{ isIntersecting: true }]));
}

function mount(coveredBy?: () => Element | null) {
  return render(<AutoplayVideo src="/a.mp4" poster="/a.webp" label="Demo clip" name="Browser" coveredBy={coveredBy} />);
}

/** A cover whose top edge is `top`; the clip spans 0..100 (height 100). */
function stubCover(top: number) {
  const cover = document.createElement("div");
  const state = { top };
  vi.spyOn(cover, "getBoundingClientRect").mockImplementation(() => ({ top: state.top }) as DOMRect);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => ({ top: 0, bottom: 100, height: 100 }) as DOMRect,
  );
  const scroll = (next: number) => {
    state.top = next;
    act(() => {
      fireEvent.scroll(window);
      frames.splice(0).forEach((cb) => cb(0));
    });
  };
  return { cover, scroll };
}

beforeEach(() => {
  observers = [];
  play.mockReset().mockResolvedValue(undefined);
  pause.mockReset();
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause);
  stubMatchMedia(false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AutoplayVideo", () => {
  it("renders a muted, looping, control-less, aria-hidden video", () => {
    const { container } = mount();
    const video = container.querySelector("video")!;
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.hasAttribute("controls")).toBe(false);
    expect(video.getAttribute("aria-hidden")).toBe("true");
    expect(video.hasAttribute("aria-label")).toBe(false);
  });

  it("describes the clip in a visually hidden element", () => {
    const { container } = mount();
    const description = container.querySelector(".sr-only")!;
    expect(description.textContent).toBe("Demo clip");
    expect(description.closest("video")).toBeNull();
  });

  it("sets poster and source only once the clip is near the viewport", () => {
    const { container } = mount();
    const video = container.querySelector("video")!;
    expect(video.hasAttribute("poster")).toBe(false);
    expect(container.querySelector("source")).toBeNull();
    setNear();
    expect(video.getAttribute("poster")).toBe("/a.webp");
    expect(container.querySelector("source")!.getAttribute("src")).toBe("/a.mp4");
    expect(nearObserver()!.disconnect).toHaveBeenCalled();
  });

  it("uses a 400px margin for the near observer", () => {
    mount();
    expect(nearObserver()!.options.rootMargin).toBe("400px 0px");
  });

  it("shows the poster at once without IntersectionObserver", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    delete (window as unknown as Record<string, unknown>).IntersectionObserver;
    const { container } = mount();
    expect(container.querySelector("video")!.getAttribute("poster")).toBe("/a.webp");
    expect(play).not.toHaveBeenCalled();
  });

  it.each([
    ["enters view", true, 1, 0],
    ["leaves view", false, 0, 1],
  ])("when the video %s it calls play/pause accordingly", (_n, intersecting, plays, pauses) => {
    mount();
    setIntersecting(intersecting);
    expect(play).toHaveBeenCalledTimes(plays);
    expect(pause).toHaveBeenCalledTimes(pauses);
  });

  it("labels the button with the card name", () => {
    mount();
    expect(screen.getByRole("button", { name: "Play Browser video" })).toBeTruthy();
    act(() => {
      fireEvent.play(document.querySelector("video")!);
    });
    expect(screen.getByRole("button", { name: "Pause Browser video" })).toBeTruthy();
  });

  it("does not autoplay under reduced motion, plays on click, pauses on leave and does not resume", () => {
    stubMatchMedia(true);
    mount();
    expect(inViewObserver()).toBeDefined();
    setIntersecting(true);
    expect(play).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Play Browser video" }));
    expect(play).toHaveBeenCalledTimes(1);
    setIntersecting(false);
    expect(pause).toHaveBeenCalledTimes(1);
    setIntersecting(true);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("reads reduced motion at decision time", () => {
    mount();
    setReduced(true);
    setIntersecting(true);
    expect(play).not.toHaveBeenCalled();
  });

  it("pauses an autoplaying clip when reduced motion turns on", () => {
    mount();
    setIntersecting(true);
    expect(pause).not.toHaveBeenCalled();
    setReduced(true);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it("keeps a manually started clip playing when reduced motion turns on", () => {
    stubMatchMedia(false);
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Play Browser video" }));
    setReduced(true);
    expect(pause).not.toHaveBeenCalled();
  });

  it("does not autoplay without IntersectionObserver", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    delete (window as unknown as Record<string, unknown>).IntersectionObserver;
    mount();
    expect(play).not.toHaveBeenCalled();
  });

  it("swallows a rejected play() promise", async () => {
    play.mockRejectedValue(new DOMException("blocked", "NotAllowedError"));
    mount();
    setIntersecting(true);
    await act(async () => {});
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("stays paused after a manual pause until play is pressed", () => {
    const { container } = mount();
    const video = container.querySelector("video")!;
    setIntersecting(true);
    act(() => {
      fireEvent.play(video);
    });
    fireEvent.click(screen.getByRole("button", { name: "Pause Browser video" }));
    act(() => {
      fireEvent.pause(video);
    });
    setIntersecting(false);
    setIntersecting(true);
    expect(play).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Play Browser video" }));
    expect(play).toHaveBeenCalledTimes(2);
    act(() => {
      fireEvent.play(video);
    });
    setIntersecting(false);
    setIntersecting(true);
    expect(play).toHaveBeenCalledTimes(3);
  });

  it("pauses while a later card covers more than half of the clip and resumes when uncovered", () => {
    const { cover, scroll } = stubCover(500);
    mount(() => cover);
    setIntersecting(true);
    expect(play).toHaveBeenCalledTimes(1);

    scroll(40);
    expect(pause).toHaveBeenCalledTimes(1);

    scroll(500);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["more than half covered", 40, 1],
    ["less than half covered", 70, 0],
  ])("%s", (_n, top, pauses) => {
    const { cover, scroll } = stubCover(500);
    mount(() => cover);
    setIntersecting(true);
    scroll(top);
    expect(pause).toHaveBeenCalledTimes(pauses);
  });

  it("does not resume a covered clip the user paused", () => {
    const { cover, scroll } = stubCover(500);
    const { container } = mount(() => cover);
    const video = container.querySelector("video")!;
    setIntersecting(true);
    act(() => {
      fireEvent.play(video);
    });
    fireEvent.click(screen.getByRole("button", { name: "Pause Browser video" }));
    scroll(40);
    scroll(500);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("starts covered clips paused when they enter view already covered", () => {
    const { cover } = stubCover(40);
    mount(() => cover);
    setIntersecting(true);
    expect(play).not.toHaveBeenCalled();
  });

  it("disconnects both observers on unmount", () => {
    mount().unmount();
    expect(observers.length).toBeGreaterThan(0);
    observers.forEach((o) => expect(o.disconnect).toHaveBeenCalled());
  });
});
