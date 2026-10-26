import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import { ConversationFilesPopover } from "../ConversationFilesPopover";

const deletedDocs = vi.hoisted(() => new Set<string>());
vi.mock("@/lib/docs/docStore", () => ({
  getDoc: (id: string) => (deletedDocs.has(id) ? null : { id, title: `Live ${id}` }),
}));

afterEach(() => {
  cleanup();
  deletedDocs.clear();
  delete window.penAgentPanel;
});

const docPart = (n: number) => ({
  type: "tool-doc_create",
  toolCallId: `d${n}`,
  state: "output-available",
  input: {},
  output: { docId: `doc${n}`, title: `Doc ${n}` },
});
const msgs = (...parts: unknown[]) => [{ id: "m", role: "assistant", parts }] as unknown as UIMessage[];

function openPopover(messages: UIMessage[]) {
  render(<ConversationFilesPopover getMessages={() => messages} />);
  fireEvent.click(screen.getByTestId("conversation-files-trigger"));
}

describe("<ConversationFilesPopover />", () => {
  it("shows the empty state", async () => {
    openPopover([]);
    expect(await screen.findByText(/appear here/)).toBeTruthy();
  });

  it("renders sections and hides empty ones", async () => {
    openPopover(
      msgs(docPart(1), {
        type: "tool-browse_agent",
        toolCallId: "b",
        state: "output-available",
        input: { goal: "Test checkout" },
        output: { trace: { id: "t", source: "cloud" } },
      }),
    );
    expect(await screen.findByText("Documents")).toBeTruthy();
    expect(screen.getByText("Live doc1")).toBeTruthy();
    expect(screen.getByText("Traces")).toBeTruthy();
    expect(screen.getByText("Test checkout")).toBeTruthy();
    expect(screen.queryByText("Canvases")).toBeNull();
  });

  it("limits to 5 rows and expands with Show all", async () => {
    openPopover(msgs(...[1, 2, 3, 4, 5, 6, 7].map(docPart)));
    await screen.findByText("Documents");
    expect(screen.queryByText("Live doc1")).toBeNull();
    fireEvent.click(screen.getByText("Show all (7)"));
    expect(screen.getByText("Live doc1")).toBeTruthy();
    expect(screen.queryByText(/Show all/)).toBeNull();
  });

  it("opens a doc through the panel docs bridge", async () => {
    const open = vi.fn(async () => ({ ok: true }));
    window.penAgentPanel = { version: 2, docs: { open } } as never;
    openPopover(msgs(docPart(1)));
    fireEvent.click(await screen.findByText("Live doc1"));
    expect(open).toHaveBeenCalledWith("doc1");
  });

  it("shows a deleted document disabled with a fallback title", async () => {
    deletedDocs.add("doc1");
    openPopover(msgs(docPart(1)));
    const row = (await screen.findByText("Doc 1")).closest("button");
    expect(row?.disabled).toBe(true);
    expect(screen.getByText("deleted")).toBeTruthy();
  });

  it("hides a local trace that cannot be opened but keeps a cloud trace", async () => {
    const trace = (n: string, source: string) => ({
      type: "tool-browse_agent",
      toolCallId: n,
      state: "output-available",
      input: { goal: `Goal ${n}` },
      output: { trace: { id: n, source } },
    });
    openPopover(msgs(trace("l", "local"), trace("c", "cloud")));
    expect(await screen.findByText("Goal c")).toBeTruthy();
    expect(screen.queryByText("Goal l")).toBeNull();
  });
});
