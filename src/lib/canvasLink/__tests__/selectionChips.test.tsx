import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatInput } from "@/components/chat/ChatInput";
import { useChatStore } from "@/store/chatStore";
import { PanelClient } from "../panelClient";
import { resetPanelRuntimeForTests, startPanelRuntime } from "../panelRuntime";
import type { SelectionChipsSnapshot } from "../protocol";
import { createFakeCanvasBridge, tab, type FakeCanvasBridge } from "./fakeCanvasBridge";

const snap = (...names: string[]): SelectionChipsSnapshot => ({
  nodes: names.map((name) => ({ nodeId: `id-${name}`, name, type: "frame" })),
  embedElement: null,
});
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("PanelClient selection chips", () => {
  let fake: FakeCanvasBridge;
  let client: PanelClient;
  const setup = (tabs = [tab(1), tab(2)]) => {
    fake = createFakeCanvasBridge(tabs);
    client = new PanelClient({ bridge: fake.bridge });
    client.subscribe(() => {}); // chips are on screen
  };
  afterEach(() => client.dispose());

  it("keeps the latest selection per tab; unbound chats read the first listed tab", async () => {
    setup();
    await flush();
    fake.emit(1, { kind: "selection", selection: snap("A") });
    fake.emit(2, { kind: "selection", selection: snap("B") });
    expect(client.selectionFor("s")?.nodes[0].name).toBe("A");
    fake.emit(1, { kind: "selection", selection: snap("A2") });
    expect(client.selectionFor("s")?.nodes[0].name).toBe("A2");
  });

  it("reads the tab the chat is bound to", async () => {
    setup();
    await flush();
    fake.emit(1, { kind: "selection", selection: snap("A") });
    fake.emit(2, { kind: "selection", selection: snap("B") });
    await client.bindTo("s", 2);
    expect(client.selectionFor("s")?.nodes[0].name).toBe("B");
    expect(client.selectionFor("other")?.nodes[0].name).toBe("A");
  });

  it("drops a tab's selection on tab-gone and notifies; a newer registration keeps its own", async () => {
    setup([tab(1)]);
    await flush();
    const changed = vi.fn();
    client.subscribe(changed);
    fake.emit(1, { kind: "selection", selection: snap("A") });
    expect(changed).toHaveBeenCalledTimes(1);
    fake.closeTab(1);
    expect(client.selectionFor("s")).toBeNull();
    expect(changed.mock.calls.length).toBeGreaterThan(1);

    fake.setTabs([tab(1, 2)]);
    fake.emit(1, { kind: "selection", selection: snap("New") });
    fake.emit(1, { kind: "tab-gone", registrationId: 1 }); // late tab-gone of the old registration
    expect(client.selectionFor("s")?.nodes[0].name).toBe("New");
  });

  it("a snapshot from a new registration seen before the tab list updated is re-requested after a late old tab-gone", async () => {
    setup([tab(1, 1)]);
    await flush();
    fake.emit(1, { kind: "selection", selection: snap("New") }); // list still shows registration 1
    fake.emit(1, { kind: "tab-gone", registrationId: 1 });
    expect(client.selectionFor("s")).toBeNull();
    fake.setTabs([tab(1, 2)]); // the list catches up: the new registration is asked
    const asks = fake.posted.filter((p) => p.env.msg.kind === "selection-request");
    expect(asks).toHaveLength(2);
    fake.emit(1, { kind: "selection", selection: snap("New") });
    expect(client.selectionFor("s")?.nodes[0].name).toBe("New");
  });

  it("re-asks after a main error for the selection-request, on the next tab-list change", async () => {
    setup([tab(1)]);
    await flush();
    const first = fake.posted.find((p) => p.env.msg.kind === "selection-request")!;
    fake.emit(1, { kind: "error", refId: first.env.id, error: "No canvas tab" });
    fake.setTabs([tab(1)]);
    expect(fake.ofKind("selection-request")).toHaveLength(2);
  });

  it("re-asks after the bridge threw while sending the request", async () => {
    fake = createFakeCanvasBridge([tab(1)]);
    const post = fake.bridge.post;
    fake.bridge.post = () => {
      throw new Error("ipc down");
    };
    client = new PanelClient({ bridge: fake.bridge });
    client.subscribe(() => {});
    await flush();
    fake.bridge.post = post;
    fake.setTabs([tab(1)]);
    expect(fake.ofKind("selection-request")).toHaveLength(1);
  });

  it("reads the tab list once per client however often chips subscribe", async () => {
    fake = createFakeCanvasBridge([tab(1)]);
    const listTabs = vi.spyOn(fake.bridge, "listTabs");
    client = new PanelClient({ bridge: fake.bridge });
    client.subscribe(() => {});
    client.subscribe(() => {});
    await flush();
    expect(listTabs).toHaveBeenCalledTimes(1);
    expect(fake.ofKind("selection-request")).toHaveLength(1);
  });

  it("asks a listed tab it has no selection for, once", async () => {
    setup([tab(1)]);
    await flush();
    expect(fake.ofKind("selection-request")).toHaveLength(1);
    fake.setTabs([tab(1), tab(2)]);
    fake.setTabs([tab(1), tab(2)]);
    expect(fake.posted.filter((p) => p.env.msg.kind === "selection-request").map((p) => p.tabId)).toEqual([1, 2]);
  });
});

describe("selection chips in the /agent panel", () => {
  let fake: FakeCanvasBridge;
  beforeEach(() => {
    fake = createFakeCanvasBridge([tab(1)]);
    window.penAgentPanel = { version: 2, canvas: fake.bridge };
    useChatStore.setState({ attachedImages: {} });
  });
  afterEach(() => {
    cleanup();
    resetPanelRuntimeForTests();
    delete window.penAgentPanel;
  });

  function Harness() {
    const [input, setInput] = useState("");
    return <ChatInput sessionId="s" input={input} setInput={setInput} onSubmit={vi.fn()} isLoading={false} stop={() => {}} />;
  }

  it("renders chips from the bound tab's published selection, updates and clears them", async () => {
    startPanelRuntime();
    render(<Harness />);
    await act(flush);
    expect(screen.queryByLabelText("Hero")).toBeNull();
    act(() => fake.emit(1, { kind: "selection", selection: snap("Hero") }));
    expect(screen.getByLabelText("Hero")).toBeDefined();
    act(() =>
      fake.emit(1, {
        kind: "selection",
        selection: {
          nodes: [],
          embedElement: {
            label: "button.cta",
            embedName: "Landing",
            textPreview: "Go",
          },
        },
      })
    );
    expect(screen.queryByLabelText("Hero")).toBeNull();
    expect(screen.getByLabelText("Selected embed element: button.cta")).toBeDefined();
    act(() => fake.closeTab(1));
    expect(screen.queryByLabelText("Selected embed element: button.cta")).toBeNull();
  });
});
