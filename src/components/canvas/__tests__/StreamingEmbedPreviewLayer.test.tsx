import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { EmbedLayer } from "../EmbedLayer";
import { useAiPendingScreenStore, pendingScreenKey } from "@/store/aiPendingScreenStore";
import { useEditorModeStore } from "@/store/editorModeStore";
import { resetStores } from "@/test/fixtures";

const SCREEN = { index: 0, start: 0, htmlComplete: false, name: "Login", x: 0, y: 0, width: 390, height: 844 };

function stage(html: string): void {
  act(() => {
    useAiPendingScreenStore.getState().upsert({
      sessionId: "s1",
      toolCallId: "c1",
      screens: [{ ...SCREEN, html }],
    });
  });
}

describe("<StreamingEmbedPreviewLayer />", () => {
  beforeEach(() => {
    resetStores();
    useAiPendingScreenStore.getState().reset();
  });
  afterEach(() => cleanup());

  it("renders staged partial html in a non-interactive shadow host and removes it when cleared", () => {
    const { container } = render(<EmbedLayer />);
    const host = () => container.querySelector<HTMLElement>("[data-streaming-embed-preview]");
    const shadow = () =>
      container.querySelector<HTMLElement>("[data-streaming-embed-shadow]")?.shadowRoot;
    expect(host()).toBeNull();

    // A header with no html yet shows nothing (the dashed Pixi box covers it).
    stage("");
    expect(host()).toBeNull();

    stage("<div><h1>Welcome back</h1><p>Sign in to con");
    expect(host()).not.toBeNull();
    expect(host()!.style.pointerEvents).toBe("none");
    expect(shadow()!.textContent).toContain("Welcome back");

    act(() => {
      useAiPendingScreenStore.getState().clearDraft(pendingScreenKey("s1", "c1"));
    });
    expect(host()).toBeNull();
  });

  it("does not remount when only the screen identity changes", () => {
    const { container } = render(<EmbedLayer />);
    stage("<div><p>same</p></div>");
    const shadow = container.querySelector<HTMLElement>("[data-streaming-embed-shadow]")!.shadowRoot!;
    const marker = shadow.querySelector("p")!;
    stage("<div><p>same</p></div>"); // identical html, new object
    act(() => {
      useAiPendingScreenStore.getState().upsert({
        sessionId: "s1",
        toolCallId: "c1",
        screens: [{ ...SCREEN, html: "<div><p>same</p></div>", name: "Renamed" }],
      });
    });
    expect(shadow.querySelector("p")).toBe(marker);
  });

  it("is not rendered in present mode", () => {
    useEditorModeStore.setState({ mode: "present", presentFrameIds: [], presentIndex: 0 });
    const { container } = render(<EmbedLayer />);
    stage("<div><p>hi</p></div>");
    expect(container.querySelector("[data-streaming-embed-preview]")).toBeNull();
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
  });

  it("picks up :root custom properties that arrive after the first mount", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<EmbedLayer />);
      // Leading element first: happy-dom's sanitizer drops a leading <style>.
      stage('<p class="card">x</p><style>.card{color:var(--screen-tint)}');
      const shadow = container.querySelector<HTMLElement>("[data-streaming-embed-shadow]")!.shadowRoot!;
      stage('<p class="card">x</p><style>.card{color:var(--screen-tint)} :root{--screen-tint:#ff6a00}</style>');
      act(() => {
        vi.advanceTimersByTime(200);
      });
      const box = shadow.firstElementChild as HTMLElement;
      expect(box.style.getPropertyValue("--screen-tint").trim()).toBe("#ff6a00");
    } finally {
      vi.useRealTimers();
    }
  });

  it("morphs growing html in place: img identity kept, only new roots revealed, head is outside the shadow root", () => {
    vi.useFakeTimers();
    const animate = vi.fn(() => ({ cancel() {}, finished: Promise.resolve() }));
    const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
    Object.defineProperty(Element.prototype, "animate", { value: animate, configurable: true, writable: true });
    try {
      const { container } = render(<EmbedLayer />);
      stage('<div><img src="a.png"><p>one</p></div>');
      const shadowHost = container.querySelector<HTMLElement>("[data-streaming-embed-shadow]")!;
      const shadow = shadowHost.shadowRoot!;
      const img = shadow.querySelector("img")!;
      // Head line lives beside the shadow host, not in the shadow tree.
      expect(shadow.querySelector("[style*='gradient']")).toBeNull();
      expect(shadowHost.nextElementSibling).not.toBeNull();
      animate.mockClear();

      stage('<div><img src="a.png"><p>one</p><section><p>two</p><span>x</span></section></div>');
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(shadow.querySelector("img")).toBe(img);
      expect(shadow.textContent).toContain("two");
      // One reveal for the single inserted <section>, none for its descendants.
      const revealed = animate.mock.contexts.map((el) => (el as Element).tagName);
      expect(revealed).toEqual(["SECTION"]);
    } finally {
      if (originalAnimate) Object.defineProperty(Element.prototype, "animate", originalAnimate);
      else delete (Element.prototype as unknown as { animate?: unknown }).animate;
      vi.useRealTimers();
    }
  });
});
