import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSceneStore } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";
import { resetStores } from "@/test/fixtures";
import type { FlatSceneNode } from "@/types/scene";
import { editEmbedHtml } from "../editEmbedHtml";
import {
  applyStreamingEmbedHtmlEdits,
  takeProgressiveEmbedHtmlSession,
  abandonProgressiveEmbedHtmlSession,
  clearProgressiveEmbedHtmlSessions,
} from "../editEmbedHtmlProgressive";

function seedEmbed(id: string, htmlContent: string, extra: Record<string, unknown> = {}) {
  const node = {
    id,
    type: "embed",
    name: "Screen",
    x: 0,
    y: 0,
    width: 390,
    height: 844,
    htmlContent,
    ...extra,
  } as unknown as FlatSceneNode;
  const state = useSceneStore.getState();
  useSceneStore.setState({
    nodesById: { ...state.nodesById, [id]: node },
    parentById: { ...state.parentById, [id]: null },
    rootIds: [...state.rootIds, id],
    _cachedTree: null,
  });
}

const htmlOf = (id: string) =>
  (useSceneStore.getState().nodesById[id] as unknown as { htmlContent: string }).htmlContent;

// Sessions are keyed by `${sessionId}:${toolCallId}` and, once taken/
// abandoned/cleared, the key is permanently finalized — so every test below
// uses its own toolCallId to avoid colliding with a key another test already
// finalized (module-level state persists across tests in this file).

describe("editEmbedHtmlProgressive", () => {
  beforeEach(() => {
    resetStores();
    try {
      globalThis.localStorage?.removeItem("pen.streamingMutations");
    } catch {
      // ignore
    }
  });

  it("re-derives from the original on every frame: a truncated newString has no lingering effect", () => {
    seedEmbed("e1", '<button class="cta">Buy</button>');

    // Frame 1: a fully-decoded oldString but a still-typing (truncated) newString.
    // The trailing "<" of ">Get st" has not streamed in yet, so it is not in
    // the replacement — this is what a genuinely truncated frame looks like.
    applyStreamingEmbedHtmlEdits({
      sessionId: "s1",
      toolCallId: "t-rederive",
      input: { nodeId: "e1", edits: [{ oldString: ">Buy<", newString: ">Get st" }] },
    });
    expect(htmlOf("e1")).toBe('<button class="cta">Get st/button>');

    // Frame 2: the complete edit. Must fully replace frame 1's output, not
    // append to it — re-derivation always starts from the pristine original.
    applyStreamingEmbedHtmlEdits({
      sessionId: "s1",
      toolCallId: "t-rederive",
      input: { nodeId: "e1", edits: [{ oldString: ">Buy<", newString: ">Get started<" }] },
    });
    expect(htmlOf("e1")).toBe('<button class="cta">Get started</button>');
  });

  it("ignores a frame whose edits arrive as a partially-decoded (unparseable) JSON string", () => {
    seedEmbed("e1", "<p>hi</p>");
    applyStreamingEmbedHtmlEdits({
      sessionId: "s1",
      toolCallId: "t-unparseable",
      input: { nodeId: "e1", edits: '[{"oldString":"hi","newStr' },
    });
    expect(htmlOf("e1")).toBe("<p>hi</p>");
  });

  it("accepts edits as a JSON string once it parses cleanly", () => {
    seedEmbed("e1", "<p>hi</p>");
    applyStreamingEmbedHtmlEdits({
      sessionId: "s1",
      toolCallId: "t-jsonstring",
      input: { nodeId: "e1", edits: JSON.stringify([{ oldString: "hi", newString: "bye" }]) },
    });
    expect(htmlOf("e1")).toBe("<p>bye</p>");
  });

  it("skips a frame with no nodeId", () => {
    seedEmbed("e1", "<p>hi</p>");
    applyStreamingEmbedHtmlEdits({
      sessionId: "s1",
      toolCallId: "t-nonodeid",
      input: { edits: [{ oldString: "hi", newString: "bye" }] },
    });
    expect(htmlOf("e1")).toBe("<p>hi</p>");
  });

  it("skips a frame pointing at a missing node", () => {
    applyStreamingEmbedHtmlEdits({
      sessionId: "s1",
      toolCallId: "t-missingnode",
      input: { nodeId: "ghost", edits: [{ oldString: "hi", newString: "bye" }] },
    });
    expect(useSceneStore.getState().nodesById.ghost).toBeUndefined();
  });

  it("skips a frame pointing at a non-embed node", () => {
    const state = useSceneStore.getState();
    const rectNode = {
      id: "r1",
      type: "rect",
      name: "Box",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    } as unknown as FlatSceneNode;
    useSceneStore.setState({
      nodesById: { ...state.nodesById, r1: rectNode },
      rootIds: [...state.rootIds, "r1"],
    });
    applyStreamingEmbedHtmlEdits({
      sessionId: "s1",
      toolCallId: "t-nonembed",
      input: { nodeId: "r1", edits: [{ oldString: "a", newString: "b" }] },
    });
    expect(useSceneStore.getState().nodesById.r1).toBe(rectNode);
  });

  it("writes no undo entry while streaming, and the final commit leaves exactly one", async () => {
    seedEmbed("e1", '<button class="cta">Buy</button>');
    const before = useHistoryStore.getState().past.length;

    applyStreamingEmbedHtmlEdits({
      sessionId: "s1",
      toolCallId: "t-undo",
      input: { nodeId: "e1", edits: [{ oldString: ">Buy<", newString: ">Get st" }] },
    });
    applyStreamingEmbedHtmlEdits({
      sessionId: "s1",
      toolCallId: "t-undo",
      input: { nodeId: "e1", edits: [{ oldString: ">Buy<", newString: ">Get started<" }] },
    });
    expect(useHistoryStore.getState().past.length).toBe(before);

    await editEmbedHtml(
      { nodeId: "e1", edits: [{ oldString: ">Buy<", newString: ">Get started<" }] },
      { sessionId: "s1", toolCallId: "t-undo" },
    );
    expect(useHistoryStore.getState().past.length).toBe(before + 1);
  });

  it("the final tool result for a streamed call is identical to the same call run without streaming", async () => {
    seedEmbed("e1", '<button class="cta">Buy</button>');
    seedEmbed("e2", '<button class="cta">Buy</button>');

    applyStreamingEmbedHtmlEdits({
      sessionId: "s1",
      toolCallId: "t-parity",
      input: { nodeId: "e1", edits: [{ oldString: ">Buy<", newString: ">Get st" }] },
    });
    const streamed = await editEmbedHtml(
      { nodeId: "e1", edits: [{ oldString: ">Buy<", newString: ">Get started<" }] },
      { sessionId: "s1", toolCallId: "t-parity" },
    );
    const unstreamed = await editEmbedHtml({
      nodeId: "e2",
      edits: [{ oldString: ">Buy<", newString: ">Get started<" }],
    });

    expect(JSON.parse(streamed)).toEqual({ ...JSON.parse(unstreamed), nodeId: "e1" });
    expect(htmlOf("e1")).toBe(htmlOf("e2"));
  });

  it("abandon restores the original html and finalizes the key", () => {
    seedEmbed("e1", '<button class="cta">Buy</button>');
    applyStreamingEmbedHtmlEdits({
      sessionId: "s1",
      toolCallId: "t-abandon",
      input: { nodeId: "e1", edits: [{ oldString: ">Buy<", newString: ">Get started<" }] },
    });
    expect(htmlOf("e1")).toBe('<button class="cta">Get started</button>');

    abandonProgressiveEmbedHtmlSession("s1", "t-abandon");
    expect(htmlOf("e1")).toBe('<button class="cta">Buy</button>');

    // The key is finalized: a late frame for the same call cannot resurrect it.
    applyStreamingEmbedHtmlEdits({
      sessionId: "s1",
      toolCallId: "t-abandon",
      input: { nodeId: "e1", edits: [{ oldString: ">Buy<", newString: ">Late<" }] },
    });
    expect(htmlOf("e1")).toBe('<button class="cta">Buy</button>');
  });

  it("a foreign mutation detaches instead of clobbering, and abandon does not stomp it", () => {
    seedEmbed("e1", '<button class="cta">Buy</button>');
    applyStreamingEmbedHtmlEdits({
      sessionId: "s1",
      toolCallId: "t-foreign",
      input: { nodeId: "e1", edits: [{ oldString: ">Buy<", newString: ">Get started<" }] },
    });
    expect(htmlOf("e1")).toBe('<button class="cta">Get started</button>');

    // Someone else mutates the scene in between frames (a fresh nodesById object).
    const state = useSceneStore.getState();
    useSceneStore.setState({ nodesById: { ...state.nodesById }, _cachedTree: null });
    const foreignNode = {
      ...(useSceneStore.getState().nodesById.e1 as unknown as Record<string, unknown>),
      htmlContent: '<button class="cta">Foreign edit</button>',
    } as unknown as FlatSceneNode;
    useSceneStore.setState({
      nodesById: { ...useSceneStore.getState().nodesById, e1: foreignNode },
      _cachedTree: null,
    });

    // Next frame must detach rather than overwrite the foreign edit.
    applyStreamingEmbedHtmlEdits({
      sessionId: "s1",
      toolCallId: "t-foreign",
      input: { nodeId: "e1", edits: [{ oldString: ">Buy<", newString: ">Streamed again<" }] },
    });
    expect(htmlOf("e1")).toBe('<button class="cta">Foreign edit</button>');

    abandonProgressiveEmbedHtmlSession("s1", "t-foreign");
    expect(htmlOf("e1")).toBe('<button class="cta">Foreign edit</button>');
  });

  it("clearProgressiveEmbedHtmlSessions restores an active session for a chat session", () => {
    seedEmbed("e1", "<p>a</p>");
    applyStreamingEmbedHtmlEdits({
      sessionId: "s-clear",
      toolCallId: "t-clear-1",
      input: { nodeId: "e1", edits: [{ oldString: "a", newString: "A" }] },
    });
    expect(htmlOf("e1")).toBe("<p>A</p>");

    clearProgressiveEmbedHtmlSessions("s-clear");
    expect(htmlOf("e1")).toBe("<p>a</p>");

    // The keys are finalized: clearing again, or a late frame, is a no-op.
    applyStreamingEmbedHtmlEdits({
      sessionId: "s-clear",
      toolCallId: "t-clear-1",
      input: { nodeId: "e1", edits: [{ oldString: "a", newString: "Late" }] },
    });
    expect(htmlOf("e1")).toBe("<p>a</p>");
  });

  it("a sibling call's write to a DIFFERENT node does not block this node's restore on clear", () => {
    // Two progressive sessions writing to different nodes still share one
    // `nodesById` object; each write replaces that object, so a whole-store
    // identity check would go stale for an idle session the moment ANY
    // other write lands — including another streaming call's, not just a
    // human edit. Restore is gated per-node (comparing THIS node's own
    // `htmlContent`, not the whole-store reference) precisely so that
    // unrelated churn elsewhere never leaves this session's truncated html
    // stranded with no undo entry to recover it (see
    // `restoreProgressiveSessionHtml` in editEmbedHtmlProgressive.ts).
    // This test previously asserted the OLD, whole-store-identity behavior
    // (t-stale-1's write left in place, unrestored) — that was the defect;
    // both nodes must restore to their pristine html here.
    seedEmbed("e1", "<p>a</p>");
    seedEmbed("e2", "<p>b</p>");
    applyStreamingEmbedHtmlEdits({
      sessionId: "s-stale",
      toolCallId: "t-stale-1",
      input: { nodeId: "e1", edits: [{ oldString: "a", newString: "A" }] },
    });
    applyStreamingEmbedHtmlEdits({
      sessionId: "s-stale",
      toolCallId: "t-stale-2",
      input: { nodeId: "e2", edits: [{ oldString: "b", newString: "B" }] },
    });

    clearProgressiveEmbedHtmlSessions("s-stale");
    expect(htmlOf("e1")).toBe("<p>a</p>");
    expect(htmlOf("e2")).toBe("<p>b</p>");
  });

  it("an unrelated node's write between the last streamed frame and abandon still restores this node", () => {
    // Regression for the same defect as above, but via abandon (not clear)
    // and with the foreign write landing on a DIFFERENT node than the one
    // being restored — this must never be treated as a conflict.
    seedEmbed("e1", '<button class="cta">Buy</button>');
    seedEmbed("e2", "<p>untouched</p>");
    applyStreamingEmbedHtmlEdits({
      sessionId: "s1",
      toolCallId: "t-unrelated-node-write-abandon",
      input: { nodeId: "e1", edits: [{ oldString: ">Buy<", newString: ">Get started<" }] },
    });
    expect(htmlOf("e1")).toBe('<button class="cta">Get started</button>');

    // A concurrent, unrelated write to e2 (e.g. another progressive session's
    // commit, a manual edit) replaces the whole `nodesById` object.
    const live = useSceneStore.getState();
    const otherNode = {
      ...(live.nodesById.e2 as unknown as Record<string, unknown>),
      htmlContent: "<p>edited elsewhere</p>",
    } as unknown as FlatSceneNode;
    useSceneStore.setState({
      nodesById: { ...live.nodesById, e2: otherNode },
      _cachedTree: null,
    });

    abandonProgressiveEmbedHtmlSession("s1", "t-unrelated-node-write-abandon");
    // e1's original html is restored despite the unrelated e2 write in between.
    expect(htmlOf("e1")).toBe('<button class="cta">Buy</button>');
    // e2's unrelated write is untouched.
    expect(htmlOf("e2")).toBe("<p>edited elsewhere</p>");
  });

  it("takeProgressiveEmbedHtmlSession removes and finalizes the key without restoring", () => {
    seedEmbed("e1", "<p>a</p>");
    applyStreamingEmbedHtmlEdits({
      sessionId: "s1",
      toolCallId: "t-take",
      input: { nodeId: "e1", edits: [{ oldString: "a", newString: "A" }] },
    });
    const session = takeProgressiveEmbedHtmlSession("s1", "t-take");
    expect(session?.nodeId).toBe("e1");
    expect(htmlOf("e1")).toBe("<p>A</p>"); // taking does not restore — the caller decides what to do next.

    expect(takeProgressiveEmbedHtmlSession("s1", "t-take")).toBeUndefined();
  });

  it("kill switch (pen.streamingMutations = off) disables progressive application", () => {
    globalThis.localStorage.setItem("pen.streamingMutations", "off");
    seedEmbed("e1", "<p>a</p>");
    applyStreamingEmbedHtmlEdits({
      sessionId: "s1",
      toolCallId: "t-killswitch",
      input: { nodeId: "e1", edits: [{ oldString: "a", newString: "A" }] },
    });
    expect(htmlOf("e1")).toBe("<p>a</p>");
    expect(takeProgressiveEmbedHtmlSession("s1", "t-killswitch")).toBeUndefined();
  });

  // --- Regression: finding 1 -------------------------------------------
  // The session must be taken (and its streamed html restored) on EVERY exit
  // path of the final handler, including an early-return validation error —
  // not only the happy path that reaches the bottom of the function.

  it("restores streamed html even when the final call's `edits` fails to parse", async () => {
    seedEmbed("e1", "<div>HELLO</div>");
    const before = useHistoryStore.getState().past.length;

    // Truncated mid-stream frame.
    applyStreamingEmbedHtmlEdits({
      sessionId: "s1",
      toolCallId: "t-badfinal",
      input: { nodeId: "e1", edits: [{ oldString: "HELLO", newString: "WOR" }] },
    });
    expect(htmlOf("e1")).toBe("<div>WOR</div>");

    // Final call whose `edits` doesn't parse as an edits array at all.
    const result = await editEmbedHtml(
      { nodeId: "e1", edits: "not an array" },
      { sessionId: "s1", toolCallId: "t-badfinal" },
    );

    expect(JSON.parse(result)).toEqual({
      error: "edits must be an array of {oldString, newString}",
    });
    // The streamed leftover must be gone — restored to the pristine original —
    // not left dangling on the node.
    expect(htmlOf("e1")).toBe("<div>HELLO</div>");
    // Streaming never touches undo, and neither does an early-return error.
    expect(useHistoryStore.getState().past.length).toBe(before);
    // The key is finalized: a late frame can't resurrect the session.
    expect(takeProgressiveEmbedHtmlSession("s1", "t-badfinal")).toBeUndefined();
  });

  it("restores streamed html even when the final call is missing nodeId", async () => {
    seedEmbed("e1", "<div>HELLO</div>");

    applyStreamingEmbedHtmlEdits({
      sessionId: "s1",
      toolCallId: "t-badnodeid",
      input: { nodeId: "e1", edits: [{ oldString: "HELLO", newString: "WOR" }] },
    });
    expect(htmlOf("e1")).toBe("<div>WOR</div>");

    const result = await editEmbedHtml(
      { edits: [{ oldString: "HELLO", newString: "WORLD" }] },
      { sessionId: "s1", toolCallId: "t-badnodeid" },
    );

    expect(JSON.parse(result)).toEqual({ error: "nodeId is required" });
    expect(htmlOf("e1")).toBe("<div>HELLO</div>");
  });

  // --- Regression: finding 2 -------------------------------------------
  // The restore guard must be scoped to THIS node's own html, not the whole
  // store's `nodesById` identity — an unrelated write elsewhere must not
  // block a safe restore, and a genuine foreign edit to this exact node must
  // produce an honest error instead of a silent "nothing changed".

  it("still restores when an UNRELATED node's write changed the nodesById reference", async () => {
    seedEmbed("e1", "<div>HELLO</div>");
    seedEmbed("e2", "<p>other</p>");

    applyStreamingEmbedHtmlEdits({
      sessionId: "s1",
      toolCallId: "t-unrelated-write",
      input: { nodeId: "e1", edits: [{ oldString: "HELLO", newString: "WORLD" }] },
    });
    expect(htmlOf("e1")).toBe("<div>WORLD</div>");

    // A completely unrelated write replaces the nodesById reference without
    // touching e1's own htmlContent at all.
    const state = useSceneStore.getState();
    useSceneStore.setState({
      nodesById: { ...state.nodesById, e2: { ...state.nodesById.e2 } as FlatSceneNode },
      _cachedTree: null,
    });

    const result = await editEmbedHtml(
      { nodeId: "e1", edits: [{ oldString: "HELLO", newString: "WORLD" }] },
      { sessionId: "s1", toolCallId: "t-unrelated-write" },
    );

    // Restore succeeded and the strict path ran normally — same result as an
    // unstreamed call would produce, not a spurious failure.
    expect(JSON.parse(result).error).toBeUndefined();
    expect(htmlOf("e1")).toBe("<div>WORLD</div>");
  });

  it("does not clobber a genuine foreign edit to THIS node, and says so honestly", async () => {
    seedEmbed("e1", "<div>HELLO</div>");

    applyStreamingEmbedHtmlEdits({
      sessionId: "s1",
      toolCallId: "t-real-conflict",
      input: { nodeId: "e1", edits: [{ oldString: "HELLO", newString: "WORLD" }] },
    });
    expect(htmlOf("e1")).toBe("<div>WORLD</div>");

    // Someone else changes THIS node's own htmlContent after our last
    // streamed write (e.g. a different tool call, or a human edit).
    const state = useSceneStore.getState();
    useSceneStore.setState({
      nodesById: {
        ...state.nodesById,
        e1: { ...state.nodesById.e1, htmlContent: "<div>Foreign edit</div>" } as FlatSceneNode,
      },
      _cachedTree: null,
    });

    const result = await editEmbedHtml(
      { nodeId: "e1", edits: [{ oldString: "HELLO", newString: "WORLD" }] },
      { sessionId: "s1", toolCallId: "t-real-conflict" },
    );

    const parsed = JSON.parse(result);
    expect(typeof parsed.error).toBe("string");
    // Honest: it must not claim nothing changed while a conflict is exactly
    // what happened, and must describe what actually happened — the node was
    // changed by another source and OUR streamed edit was discarded, not the
    // other way around.
    expect(parsed.error).not.toMatch(/nothing was changed/i);
    expect(parsed.error).toMatch(/changed from another source/i);
    expect(parsed.error).toMatch(/streamed edit was discarded/i);
    expect(parsed.error).not.toMatch(/left in place/i);
    // The foreign edit is left intact — neither reverted nor overwritten.
    expect(htmlOf("e1")).toBe("<div>Foreign edit</div>");
  });

  // --- Regression: finding 4 -------------------------------------------
  // `abandonProgressiveEmbedHtmlSession` / `clearProgressiveEmbedHtmlSessions`
  // are `StreamingToolAdapter#onAbandon`/`onSessionClear` — they must never
  // throw, even if the underlying restore itself throws.

  // --- Regression: finding 1 (review pass, 2026-09-13) -------------------
  // A frame whose derived html is byte-identical to what the node already
  // holds must skip the store write entirely — this is the common shape of
  // the leading, still-truncated `edits: [` frames, which lenient-parse to
  // `[]` and re-derive to the pristine original.

  it("skips the store write when the derived html is unchanged from what the node already holds", () => {
    seedEmbed("e1", "<p>hi</p>");
    const setStateSpy = vi.spyOn(useSceneStore, "setState");

    // A truncated `edits: [` frame: lenient parse yields `[]`, so the
    // re-derived html is identical to the untouched original.
    applyStreamingEmbedHtmlEdits({
      sessionId: "s1",
      toolCallId: "t-noop-leading",
      input: { nodeId: "e1", edits: [] },
    });
    expect(htmlOf("e1")).toBe("<p>hi</p>");
    expect(setStateSpy).not.toHaveBeenCalled();

    setStateSpy.mockRestore();
  });

  it("a no-op skip does not make a later restore treat the node as foreign-edited", () => {
    seedEmbed("e1", "<p>hi</p>");

    // Leading no-op frames: no session write ever happens.
    applyStreamingEmbedHtmlEdits({
      sessionId: "s1",
      toolCallId: "t-noop-then-abandon",
      input: { nodeId: "e1", edits: [] },
    });
    applyStreamingEmbedHtmlEdits({
      sessionId: "s1",
      toolCallId: "t-noop-then-abandon",
      input: { nodeId: "e1", edits: [] },
    });
    expect(htmlOf("e1")).toBe("<p>hi</p>");

    // Abandon must be a clean no-op (nothing was ever written, so nothing to
    // restore) rather than reporting a conflict.
    abandonProgressiveEmbedHtmlSession("s1", "t-noop-then-abandon");
    expect(htmlOf("e1")).toBe("<p>hi</p>");
  });

  it("a no-op skip after a real streamed write still restores cleanly (not a conflict)", async () => {
    seedEmbed("e1", "<p>hi</p>");

    // A real edit lands first.
    applyStreamingEmbedHtmlEdits({
      sessionId: "s1",
      toolCallId: "t-noop-after-real",
      input: { nodeId: "e1", edits: [{ oldString: "hi", newString: "bye" }] },
    });
    expect(htmlOf("e1")).toBe("<p>bye</p>");

    // A later frame re-derives the exact same edit (identical to the current
    // node content) — must be skipped, and must not disturb the bookkeeping
    // the final handler relies on.
    applyStreamingEmbedHtmlEdits({
      sessionId: "s1",
      toolCallId: "t-noop-after-real",
      input: { nodeId: "e1", edits: [{ oldString: "hi", newString: "bye" }] },
    });
    expect(htmlOf("e1")).toBe("<p>bye</p>");

    const result = await editEmbedHtml(
      { nodeId: "e1", edits: [{ oldString: "hi", newString: "bye" }] },
      { sessionId: "s1", toolCallId: "t-noop-after-real" },
    );
    expect(JSON.parse(result).error).toBeUndefined();
    expect(htmlOf("e1")).toBe("<p>bye</p>");
  });

  it("abandonProgressiveEmbedHtmlSession never throws even if the restore write throws", () => {
    seedEmbed("e1", "<p>a</p>");
    applyStreamingEmbedHtmlEdits({
      sessionId: "s1",
      toolCallId: "t-throw-abandon",
      input: { nodeId: "e1", edits: [{ oldString: "a", newString: "A" }] },
    });

    const spy = vi.spyOn(useSceneStore, "setState").mockImplementationOnce(() => {
      throw new Error("boom");
    });
    try {
      expect(() => abandonProgressiveEmbedHtmlSession("s1", "t-throw-abandon")).not.toThrow();
    } finally {
      spy.mockRestore();
    }

    // The key is still finalized despite the failed restore attempt.
    expect(takeProgressiveEmbedHtmlSession("s1", "t-throw-abandon")).toBeUndefined();
  });

  it("clearProgressiveEmbedHtmlSessions never throws even if a restore write throws", () => {
    seedEmbed("e1", "<p>a</p>");
    applyStreamingEmbedHtmlEdits({
      sessionId: "s-throw-clear",
      toolCallId: "t-throw-clear",
      input: { nodeId: "e1", edits: [{ oldString: "a", newString: "A" }] },
    });

    const spy = vi.spyOn(useSceneStore, "setState").mockImplementationOnce(() => {
      throw new Error("boom");
    });
    try {
      expect(() => clearProgressiveEmbedHtmlSessions("s-throw-clear")).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});
