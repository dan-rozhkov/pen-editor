import { cleanup, render } from "@testing-library/react";
import { type MutableRefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TabFrames } from "../TabFrames";
import type { WorkspaceTab } from "@/lib/workspace/tabsModel";

const windows = new WeakMap<HTMLIFrameElement, { focus: ReturnType<typeof vi.fn> }>();
const winOf = (el: HTMLIFrameElement) => el.contentWindow as unknown as { focus: ReturnType<typeof vi.fn> };

beforeEach(() => {
  Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
    configurable: true,
    get(this: HTMLIFrameElement) {
      let w = windows.get(this);
      if (!w) windows.set(this, (w = { focus: vi.fn() }));
      return w;
    },
  });
});
afterEach(cleanup);

const tabs: WorkspaceTab[] = [
  { id: "t1", kind: "canvas", itemId: "cv_1", title: "A" },
  { id: "t2", kind: "canvas", itemId: "cv_2", title: "B" },
  { id: "t3", kind: "doc", itemId: "d1", title: "C" },
];
const frameOf = (container: HTMLElement, id: string) => container.querySelector<HTMLIFrameElement>(`iframe[name="pen-tab-${id}"]`);

describe("TabFrames", () => {
  it("focuses the frame of a tab the user brings forward", () => {
    const framesRef: MutableRefObject<Map<string, HTMLIFrameElement>> = { current: new Map() };
    const { rerender, container } = render(<TabFrames tabs={tabs} activeTabId="t1" framesRef={framesRef} />);
    rerender(<TabFrames tabs={tabs} activeTabId="t2" framesRef={framesRef} />);
    expect(winOf(frameOf(container, "t2")!).focus).toHaveBeenCalled();
  });

  it("does not focus a tab the agent brought forward, but focuses the next user-driven change", () => {
    const framesRef: MutableRefObject<Map<string, HTMLIFrameElement>> = { current: new Map() };
    const { rerender, container } = render(<TabFrames tabs={tabs} activeTabId="t1" framesRef={framesRef} />);
    rerender(<TabFrames tabs={tabs} activeTabId="t2" framesRef={framesRef} focusFrame={false} />);
    expect(winOf(frameOf(container, "t2")!).focus).not.toHaveBeenCalled();
    // A later re-render that flips the flag does not focus an unchanged active tab.
    rerender(<TabFrames tabs={tabs} activeTabId="t2" framesRef={framesRef} focusFrame />);
    expect(winOf(frameOf(container, "t2")!).focus).not.toHaveBeenCalled();
    rerender(<TabFrames tabs={tabs} activeTabId="t1" framesRef={framesRef} focusFrame />);
    expect(winOf(frameOf(container, "t1")!).focus).toHaveBeenCalled();
  });

  it("forgets the frame of a closed tab, so a new tab with that id mounts again", () => {
    const framesRef: MutableRefObject<Map<string, HTMLIFrameElement>> = { current: new Map() };
    const { rerender, container } = render(<TabFrames tabs={tabs} activeTabId="t1" framesRef={framesRef} />);
    rerender(<TabFrames tabs={tabs.slice(1)} activeTabId="t2" framesRef={framesRef} />);
    expect(frameOf(container, "t1")).toBeNull();
    rerender(<TabFrames tabs={tabs} activeTabId="t2" framesRef={framesRef} mountIds={["t1"]} />);
    expect(frameOf(container, "t1")).not.toBeNull();
  });

  it("mounts every requested tab in one pass, so two opens in one batch both get a frame", () => {
    const framesRef: MutableRefObject<Map<string, HTMLIFrameElement>> = { current: new Map() };
    const { rerender, container } = render(<TabFrames tabs={[]} activeTabId={null} framesRef={framesRef} mountIds={[]} />);
    // Both tabs arrive together; only the last one is active.
    rerender(<TabFrames tabs={tabs} activeTabId="t2" framesRef={framesRef} mountIds={["t1", "t2"]} />);
    expect(frameOf(container, "t1")).not.toBeNull();
    expect(frameOf(container, "t2")).not.toBeNull();
    expect(frameOf(container, "t3")).toBeNull();
    expect(frameOf(container, "t1")!.style.visibility).toBe("hidden");
  });
});

describe("TabFrames order", () => {
  it("does not move or reload an iframe node when the tabs are reordered", () => {
    const framesRef: MutableRefObject<Map<string, HTMLIFrameElement>> = { current: new Map() };
    const all = ["t1", "t2", "t3"];
    const { rerender, container } = render(<TabFrames tabs={tabs} activeTabId="t1" framesRef={framesRef} mountIds={all} />);
    const before = all.map((id) => frameOf(container, id));
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((r) => records.push(...r));
    observer.observe(container, { childList: true, subtree: true });
    rerender(<TabFrames tabs={[tabs[2], tabs[0], tabs[1]]} activeTabId="t1" framesRef={framesRef} mountIds={all} />);
    records.push(...observer.takeRecords());
    observer.disconnect();
    expect(records).toHaveLength(0);
    expect(all.map((id) => frameOf(container, id))).toEqual(before);
  });
});
