import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { batchDesign } from "@/lib/tools/batchDesign";
import { parseCompleteOperationsPrefix, createCachedOperationsParser } from "@/lib/tools/batchDesign/parser";
import {
  applyStreamingBatchDesign,
  abandonProgressiveBatchSession,
  clearProgressiveBatchSessions,
} from "@/lib/tools/batchDesign/progressive";
import { useSceneStore } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";
import { resetStores, seedScene } from "@/test/fixtures";
import type { FlatFrameNode } from "@/types/scene";

function sceneState() {
  return useSceneStore.getState();
}

describe("parseCompleteOperationsPrefix", () => {
  it("drops the statement still being typed", () => {
    const partial = 'a=I(document, {type: "frame", name: "A"})\nb=I(document, {type: "fr';
    const ops = parseCompleteOperationsPrefix(partial);
    expect(ops).toHaveLength(1);
    expect(ops[0].binding).toBe("a");
  });

  it("returns nothing when the only statement isn't terminated by a newline yet", () => {
    const partial = 'a=I(document, {type: "frame", name: "A"}';
    expect(parseCompleteOperationsPrefix(partial)).toEqual([]);
  });

  it("does not end a statement on a newline inside braces (multi-line embed HTML)", () => {
    const partial =
      'a=I(document, {type: "embed", name: "A", htmlContent: "<div>\\n<p>hi</p>\\n</div>"})\nb=I(document, {type: "fra';
    const ops = parseCompleteOperationsPrefix(partial);
    expect(ops).toHaveLength(1);
    expect(ops[0].binding).toBe("a");
  });

  it("does not end a statement on a raw newline inside a quoted string", () => {
    // A backtick/quote-delimited string spanning multiple physical lines —
    // the scanner's quote-state tracking must keep braceDepth/parenDepth
    // math from ever seeing the top-level boundary inside it.
    const partial =
      'a=U("node1", {name: "line one\nline two"})\nb=I(document, {type: "fra';
    const ops = parseCompleteOperationsPrefix(partial);
    expect(ops).toHaveLength(1);
    expect(ops[0].binding).toBe("a");
  });

  it("ignores markdown code fences around the script", () => {
    const partial =
      '```\na=I(document, {type: "frame", name: "A"})\nb=I(document, {type: "fra';
    const ops = parseCompleteOperationsPrefix(partial);
    expect(ops).toHaveLength(1);
    expect(ops[0].binding).toBe("a");
  });

  it("returns an empty array when nothing is complete", () => {
    expect(parseCompleteOperationsPrefix("")).toEqual([]);
    expect(parseCompleteOperationsPrefix("a=I(document, {type: ")).toEqual([]);
  });

  it("never throws, and stops at (excluding) the first unparseable statement", () => {
    const partial =
      'a=I(document, {type: "frame", name: "A"})\n' +
      "not a valid operation at all\n" +
      'c=I(document, {type: "fra';
    const ops = parseCompleteOperationsPrefix(partial);
    expect(ops).toHaveLength(1);
    expect(ops[0].binding).toBe("a");
  });
});

describe("createCachedOperationsParser", () => {
  it("reuses the same parsed statement across calls instead of re-parsing it (finding 4)", () => {
    const parser = createCachedOperationsParser();

    const first = parser.parse(
      'a=I(document, {type: "frame", name: "A", width: 10, height: 10})\n' +
        'b=I(document, {type: "fra',
    );
    expect(first).toHaveLength(1);

    const second = parser.parse(
      'a=I(document, {type: "frame", name: "A", width: 10, height: 10})\n' +
        'b=I(document, {type: "frame", name: "B", width: 20, height: 20})\n',
    );
    expect(second).toHaveLength(2);
    // The first statement must be the EXACT SAME object as before — proof
    // that `parseLine` (and the JSON5.parse inside it) did not run again for
    // a statement that was already complete in a previous call.
    expect(second[0]).toBe(first[0]);
  });

  it("still parses a statement fresh the first time it becomes complete", () => {
    const parser = createCachedOperationsParser();
    const ops = parser.parse('x=I(document, {type: "frame", name: "X", width: 1, height: 1})\n');
    expect(ops).toHaveLength(1);
    expect(ops[0].binding).toBe("x");
  });
});

describe("applyStreamingBatchDesign + batch_design final commit", () => {
  // Progressive sessions are keyed by `${sessionId}:${toolCallId}` in a
  // module-level Map that outlives `resetStores()` (it isn't a Zustand
  // store) and, once a key is taken/abandoned, is permanently finalized —
  // so reusing the same ids across tests would leak session state (or
  // silently no-op past a finalized key) between them. A fresh pair per
  // test keeps each test's session isolated, the same way a fresh
  // toolCallId does for real, distinct tool calls.
  let sessionId: string;
  let toolCallId: string;
  let idCounter = 0;

  beforeEach(() => {
    idCounter++;
    sessionId = `session-${idCounter}`;
    toolCallId = `call-${idCounter}`;
    resetStores();
    seedScene();
  });

  afterEach(() => {
    try {
      globalThis.localStorage?.removeItem("pen.streamingMutations");
    } catch {
      // ignore
    }
  });

  it("applies complete statements during streaming without creating an undo entry", () => {
    const pastBefore = useHistoryStore.getState().past.length;

    applyStreamingBatchDesign({
      sessionId,
      toolCallId,
      operations: 'card=I(document, {type: "frame", name: "Card", width: 100, height: 100})\n',
    });

    expect(useHistoryStore.getState().past.length).toBe(pastBefore);

    const created = Object.values(sceneState().nodesById).find((n) => n.name === "Card");
    expect(created).toBeDefined();
  });

  it("the final call leaves exactly one undo entry and does not duplicate the streamed nodes", async () => {
    const pastBefore = useHistoryStore.getState().past.length;
    const script =
      'card=I(document, {type: "frame", name: "Card", width: 100, height: 100})\n' +
      'box=I(card, {type: "rect", name: "StreamBox", width: 10, height: 10})\n';

    // Stream it in two frames, as partial-JSON delivery would.
    applyStreamingBatchDesign({
      sessionId,
      toolCallId,
      operations: 'card=I(document, {type: "frame", name: "Card", width: 100, height: 100})\n',
    });
    applyStreamingBatchDesign({ sessionId, toolCallId, operations: script });

    const result = JSON.parse(await batchDesign({ operations: script }, { sessionId, toolCallId }));

    expect(result.success).toBe(true);
    expect(result.operationsExecuted).toBe(2);
    expect(useHistoryStore.getState().past.length).toBe(pastBefore + 1);

    const cards = Object.values(sceneState().nodesById).filter((n) => n.name === "Card");
    const boxes = Object.values(sceneState().nodesById).filter((n) => n.name === "StreamBox");
    expect(cards).toHaveLength(1);
    expect(boxes).toHaveLength(1);
  });

  it("streamed result matches the non-streamed result for the same script", async () => {
    const script =
      'card=I(document, {type: "frame", name: "Card", width: 100, height: 100})\n' +
      'box=I(card, {type: "rect", name: "StreamBox", width: 10, height: 10})\n';

    // Non-streamed baseline.
    resetStores();
    seedScene();
    const baseline = JSON.parse(await batchDesign({ operations: script }));

    // Streamed.
    resetStores();
    seedScene();
    applyStreamingBatchDesign({
      sessionId,
      toolCallId,
      operations: 'card=I(document, {type: "frame", name: "Card", width: 100, height: 100})\n',
    });
    const streamed = JSON.parse(
      await batchDesign({ operations: script }, { sessionId, toolCallId }),
    );

    // createdNodes/bindings carry real ids that differ run to run — compare
    // shape, not literal ids.
    expect(streamed.success).toBe(baseline.success);
    expect(streamed.operationsExecuted).toBe(baseline.operationsExecuted);
    expect(streamed.createdNodes).toHaveLength(baseline.createdNodes.length);
    expect(streamed.createdNodes.map((n: { type: string }) => n.type)).toEqual(
      baseline.createdNodes.map((n: { type: string }) => n.type),
    );
  });

  it("rolls back and falls through to the normal path when the streamed prefix diverges", async () => {
    // Stream a statement, then send a FINAL script whose first statement's
    // raw text differs from what was streamed (simulating a decode
    // reshaping) — the session must be discarded and the scene must end up
    // exactly as the final script alone would produce, with nothing
    // duplicated.
    applyStreamingBatchDesign({
      sessionId,
      toolCallId,
      operations: 'card=I(document, {type: "frame", name: "Card", width: 100, height: 100})\n',
    });

    const finalScript =
      'card=I(document, {type: "frame", name: "Different", width: 50, height: 50})\n';

    const result = JSON.parse(
      await batchDesign({ operations: finalScript }, { sessionId, toolCallId }),
    );

    expect(result.success).toBe(true);
    const named = Object.values(sceneState().nodesById).filter(
      (n) => n.name === "Card" || n.name === "Different",
    );
    expect(named).toHaveLength(1);
    expect(named[0].name).toBe("Different");
  });

  it("detaches instead of rolling back when a foreign mutation lands between frames, and doesn't duplicate", async () => {
    applyStreamingBatchDesign({
      sessionId,
      toolCallId,
      operations: 'card=I(document, {type: "frame", name: "Card", width: 100, height: 100})\n',
    });

    // A foreign mutation: something else replaces nodesById with a new
    // object (e.g. another tool call, or a manual edit) — renaming the
    // pre-existing seeded frame.
    const live = sceneState();
    useSceneStore.setState({
      nodesById: {
        ...live.nodesById,
        frame1: { ...live.nodesById.frame1, name: "RenamedByForeignEdit" } as FlatFrameNode,
      },
    });

    const script =
      'card=I(document, {type: "frame", name: "Card", width: 100, height: 100})\n' +
      'box=I(card, {type: "rect", name: "StreamBox", width: 10, height: 10})\n';

    // One more frame after the foreign edit — this is what triggers detach.
    applyStreamingBatchDesign({ sessionId, toolCallId, operations: script });

    const result = JSON.parse(await batchDesign({ operations: script }, { sessionId, toolCallId }));

    expect(result.success).toBe(true);
    // The foreign edit must have survived.
    expect(sceneState().nodesById.frame1?.name).toBe("RenamedByForeignEdit");
    // Nothing duplicated.
    const cards = Object.values(sceneState().nodesById).filter((n) => n.name === "Card");
    const boxes = Object.values(sceneState().nodesById).filter((n) => n.name === "StreamBox");
    expect(cards).toHaveLength(1);
    expect(boxes).toHaveLength(1);
  });

  it("abandon rolls back an attached session's streamed writes", () => {
    const before = JSON.stringify(sceneState().nodesById);

    applyStreamingBatchDesign({
      sessionId,
      toolCallId,
      operations: 'card=I(document, {type: "frame", name: "Card", width: 100, height: 100})\n',
    });
    expect(Object.values(sceneState().nodesById).some((n) => n.name === "Card")).toBe(true);

    abandonProgressiveBatchSession(sessionId, toolCallId);

    expect(JSON.stringify(sceneState().nodesById)).toBe(before);
  });

  it("commits fresh nodesById/rootIds identities every frame, including the final commit (finding 1)", async () => {
    // Progressive commits must give zustand a genuinely new top-level object
    // for nodesById/parentById/childrenById/rootIds every time, or every
    // selector comparing by reference (EmbedLayer, LayersPanel,
    // ComponentsPanel, SlidesPanel, PropertiesPanel, CommentLayer) stops
    // re-rendering after the very first frame.
    applyStreamingBatchDesign({
      sessionId,
      toolCallId,
      operations: 'card=I(document, {type: "frame", name: "Card", width: 100, height: 100})\n',
    });
    const nodesAfterFrame1 = sceneState().nodesById;
    const rootsAfterFrame1 = sceneState().rootIds;

    const script =
      'card=I(document, {type: "frame", name: "Card", width: 100, height: 100})\n' +
      'box=I(card, {type: "rect", name: "StreamBox", width: 10, height: 10})\n';
    applyStreamingBatchDesign({ sessionId, toolCallId, operations: script });
    const nodesAfterFrame2 = sceneState().nodesById;
    const rootsAfterFrame2 = sceneState().rootIds;

    expect(nodesAfterFrame2).not.toBe(nodesAfterFrame1);
    expect(rootsAfterFrame2).not.toBe(rootsAfterFrame1);

    const result = JSON.parse(await batchDesign({ operations: script }, { sessionId, toolCallId }));
    expect(result.success).toBe(true);

    // The FINAL commit (index.ts's finalizeAndRespond) must also be a new
    // identity relative to the last progressive frame's commit.
    expect(sceneState().nodesById).not.toBe(nodesAfterFrame2);
    expect(sceneState().rootIds).not.toBe(rootsAfterFrame2);
  });

  it("a detached session that later degrades stays rollback-unsafe forever (finding 2)", () => {
    applyStreamingBatchDesign({
      sessionId,
      toolCallId,
      operations: 'card=I(document, {type: "frame", name: "Card", width: 100, height: 100})\n',
    });

    // Foreign rename — triggers detach on the next frame.
    const live = sceneState();
    useSceneStore.setState({
      nodesById: {
        ...live.nodesById,
        frame1: { ...live.nodesById.frame1, name: "RenamedByForeignEdit" } as FlatFrameNode,
      },
    });

    const detachingScript =
      'card=I(document, {type: "frame", name: "Card", width: 100, height: 100})\n' +
      'box=I(card, {type: "rect", name: "StreamBox", width: 10, height: 10})\n';
    applyStreamingBatchDesign({ sessionId, toolCallId, operations: detachingScript });
    expect(sceneState().nodesById.frame1?.name).toBe("RenamedByForeignEdit");

    // Now feed a script whose first statement diverges from what's already
    // applied (a decode reshaping) — enough NEW statements to pass the
    // "nothing new complete yet" guard, and the divergence must degrade the
    // (already-detached) session WITHOUT losing its detached-ness.
    const divergingScript =
      'card=I(document, {type: "frame", name: "TotallyDifferent", width: 1, height: 1})\n' +
      'box=I(card, {type: "rect", name: "StreamBox", width: 10, height: 10})\n' +
      'extra=I(document, {type: "frame", name: "Extra", width: 5, height: 5})\n';
    applyStreamingBatchDesign({ sessionId, toolCallId, operations: divergingScript });

    // If `degraded` had overwritten a shared "status" field instead of being
    // tracked independently, rollbackIfSafe's detached guard would have been
    // lost and the foreign rename would now be erased by a restore of
    // baseSnapshot.
    expect(sceneState().nodesById.frame1?.name).toBe("RenamedByForeignEdit");

    abandonProgressiveBatchSession(sessionId, toolCallId);
    expect(sceneState().nodesById.frame1?.name).toBe("RenamedByForeignEdit");
  });

  it("abandon restores the scene graph structurally, including childrenById (finding 3)", () => {
    const beforeNodes = JSON.stringify(sceneState().nodesById);
    const beforeParents = JSON.stringify(sceneState().parentById);
    const beforeChildren = JSON.stringify(sceneState().childrenById);
    const beforeRoots = JSON.stringify(sceneState().rootIds);

    // Insert into frame1, which already has children (rect1, text1) from
    // seedScene — this pushes onto childrenById.frame1's array in place. If
    // that array were shared with baseSnapshot, restoring baseSnapshot would
    // leave a dangling child id behind even though nodesById lost the node.
    applyStreamingBatchDesign({
      sessionId,
      toolCallId,
      operations:
        'box=I("frame1", {type: "rect", name: "StreamedIntoFrame1", width: 10, height: 10})\n',
    });

    const createdId = Object.values(sceneState().nodesById).find(
      (n) => n.name === "StreamedIntoFrame1",
    )?.id;
    expect(createdId).toBeDefined();
    expect(sceneState().childrenById.frame1).toContain(createdId);

    abandonProgressiveBatchSession(sessionId, toolCallId);

    expect(JSON.stringify(sceneState().nodesById)).toBe(beforeNodes);
    expect(JSON.stringify(sceneState().parentById)).toBe(beforeParents);
    expect(JSON.stringify(sceneState().childrenById)).toBe(beforeChildren);
    expect(JSON.stringify(sceneState().rootIds)).toBe(beforeRoots);
  });

  it("a real moveNode between frames trips the foreign-mutation guard (finding 4)", () => {
    applyStreamingBatchDesign({
      sessionId,
      toolCallId,
      operations: 'card=I(document, {type: "frame", name: "Card", width: 100, height: 100})\n',
    });

    // Drag rect1 out of frame1 to the document root — the real store
    // action, exactly like a LayersPanel drag. This touches parentById/
    // childrenById/rootIds but deliberately NEVER nodesById.
    useSceneStore.getState().moveNode("rect1", null, 0);
    expect(sceneState().parentById.rect1).toBeNull();

    const script =
      'card=I(document, {type: "frame", name: "Card", width: 100, height: 100})\n' +
      'box=I(card, {type: "rect", name: "StreamBox", width: 10, height: 10})\n';
    applyStreamingBatchDesign({ sessionId, toolCallId, operations: script });

    // If the guard only compared nodesById, this commit would silently
    // overwrite parentById/childrenById/rootIds back to the pre-move shape.
    expect(sceneState().parentById.rect1).toBeNull();
    expect(sceneState().childrenById.frame1 ?? []).not.toContain("rect1");
    expect(sceneState().rootIds).toContain("rect1");
  });

  it("an empty final `operations` still takes and rolls back the progressive session (finding 5)", async () => {
    applyStreamingBatchDesign({
      sessionId,
      toolCallId,
      operations: 'card=I(document, {type: "frame", name: "Card", width: 100, height: 100})\n',
    });
    expect(Object.values(sceneState().nodesById).some((n) => n.name === "Card")).toBe(true);

    const result = JSON.parse(await batchDesign({ operations: "" }, { sessionId, toolCallId }));
    expect(result.error).toBe("No operations provided");

    expect(Object.values(sceneState().nodesById).some((n) => n.name === "Card")).toBe(false);
  });

  it("a parse error in the final call still takes and rolls back the progressive session (finding 5)", async () => {
    applyStreamingBatchDesign({
      sessionId,
      toolCallId,
      operations: 'card=I(document, {type: "frame", name: "Card", width: 100, height: 100})\n',
    });
    expect(Object.values(sceneState().nodesById).some((n) => n.name === "Card")).toBe(true);

    const result = JSON.parse(
      await batchDesign({ operations: "X(document)" }, { sessionId, toolCallId }),
    );
    expect(result.error).toMatch(/^Parse error:/);

    expect(Object.values(sceneState().nodesById).some((n) => n.name === "Card")).toBe(false);
  });

  it("clearProgressiveBatchSessions rolls back two concurrent sessions without stranding nodes (finding 7)", () => {
    const beforeNodes = JSON.stringify(sceneState().nodesById);
    const beforeChildren = JSON.stringify(sceneState().childrenById);
    const secondToolCallId = `${toolCallId}-2`;

    // Session 1 commits first.
    applyStreamingBatchDesign({
      sessionId,
      toolCallId,
      operations: 'first=I(document, {type: "frame", name: "First", width: 10, height: 10})\n',
    });
    expect(Object.values(sceneState().nodesById).some((n) => n.name === "First")).toBe(true);

    // Session 2 (a second concurrent tool call in the same chat session)
    // starts AFTER session 1 already committed, so its baseSnapshot includes
    // "First". Its own commit overwrites nodesById again, which is exactly
    // what leaves session 1's `lastCommitted` pointing at a stale reference.
    applyStreamingBatchDesign({
      sessionId,
      toolCallId: secondToolCallId,
      operations: 'second=I(document, {type: "frame", name: "Second", width: 10, height: 10})\n',
    });
    expect(Object.values(sceneState().nodesById).some((n) => n.name === "Second")).toBe(true);

    clearProgressiveBatchSessions(sessionId);

    expect(Object.values(sceneState().nodesById).some((n) => n.name === "First")).toBe(false);
    expect(Object.values(sceneState().nodesById).some((n) => n.name === "Second")).toBe(false);
    expect(JSON.stringify(sceneState().nodesById)).toBe(beforeNodes);
    expect(JSON.stringify(sceneState().childrenById)).toBe(beforeChildren);
  });

  it("re-checks liveness at finalize time so a foreign write landing after the last streamed frame is not clobbered (second review finding 1)", async () => {
    const script = 'card=I(document, {type: "frame", name: "Card", width: 100, height: 100})\n';

    applyStreamingBatchDesign({ sessionId, toolCallId, operations: script });
    expect(Object.values(sceneState().nodesById).some((n) => n.name === "Card")).toBe(true);

    // A foreign write landing AFTER the last streamed frame: the mid-stream
    // guard in `applyStreamingBatchDesignImpl` only re-checks liveness when a
    // NEW frame carries newly-complete statements (it sits right after the
    // "nothing new complete yet" early return), so this window — between the
    // last delta and the final handler actually running — is never inspected
    // there. Without a finalize-time check, `finishAttachedSession` would
    // write `session.ctx`'s stale fields straight over this.
    const live = sceneState();
    useSceneStore.setState({
      nodesById: {
        ...live.nodesById,
        frame1: { ...live.nodesById.frame1, name: "ForeignAfterLastFrame" } as FlatFrameNode,
      },
    });

    const result = JSON.parse(await batchDesign({ operations: script }, { sessionId, toolCallId }));

    expect(result.success).toBe(true);
    // The foreign edit must have survived the final commit.
    expect(sceneState().nodesById.frame1?.name).toBe("ForeignAfterLastFrame");
    // Nothing duplicated.
    expect(Object.values(sceneState().nodesById).filter((n) => n.name === "Card")).toHaveLength(1);
  });

  it("a destructive foreign edit (undo mid-stream) that removes an earlier streamed node forces a full fresh re-execution instead of silently dropping it (second review finding 2)", async () => {
    const op1 = 'nodeA=I(document, {type: "frame", name: "NodeA", width: 10, height: 10})\n';
    const fullScript =
      op1 + 'nodeB=I(document, {type: "frame", name: "NodeB", width: 20, height: 20})\n';

    const preOp1 = sceneState();
    const preOp1Snapshot = {
      nodesById: preOp1.nodesById,
      parentById: preOp1.parentById,
      childrenById: preOp1.childrenById,
      rootIds: preOp1.rootIds,
    };

    applyStreamingBatchDesign({ sessionId, toolCallId, operations: op1 });
    expect(Object.values(sceneState().nodesById).some((n) => n.name === "NodeA")).toBe(true);

    // Simulate an undo (Cmd+Z) mid-stream: restore the EXACT pre-op1 object
    // references, wiping out the node op1 created — this is what makes the
    // session's own bookkeeping (`createdNodeIds`, bindings) stale.
    useSceneStore.setState(preOp1Snapshot);
    expect(Object.values(sceneState().nodesById).some((n) => n.name === "NodeA")).toBe(false);

    // Both statements now stream/complete — this is what triggers detach
    // (the live store no longer matches what was last committed).
    applyStreamingBatchDesign({ sessionId, toolCallId, operations: fullScript });

    const result = JSON.parse(
      await batchDesign({ operations: fullScript }, { sessionId, toolCallId }),
    );

    expect(result.success).toBe(true);
    // Both operations must actually be reflected — not just claimed.
    expect(result.operationsExecuted).toBe(2);
    expect(result.createdNodes).toHaveLength(2);

    const nodeAs = Object.values(sceneState().nodesById).filter((n) => n.name === "NodeA");
    const nodeBs = Object.values(sceneState().nodesById).filter((n) => n.name === "NodeB");
    expect(nodeAs).toHaveLength(1);
    expect(nodeBs).toHaveLength(1);
  });

  it("abandon cleans up a DETACHED session's streamed nodes instead of leaving them stranded (third review finding 1)", () => {
    applyStreamingBatchDesign({
      sessionId,
      toolCallId,
      operations: 'card=I(document, {type: "frame", name: "Card", width: 100, height: 100})\n',
    });
    expect(Object.values(sceneState().nodesById).some((n) => n.name === "Card")).toBe(true);

    // A real user action mid-stream — dragging rect1 out of frame1 in the
    // LayersPanel — detaches the session (it touches parentById/childrenById/
    // rootIds but never nodesById, so this also exercises the all-four-field
    // guard, not just the nodesById one).
    useSceneStore.getState().moveNode("rect1", null, 0);
    expect(sceneState().parentById.rect1).toBeNull();

    const script =
      'card=I(document, {type: "frame", name: "Card", width: 100, height: 100})\n' +
      'box=I(card, {type: "rect", name: "StreamBox", width: 10, height: 10})\n';
    // One more frame after the drag — this is what trips the foreign-
    // mutation guard and forks a detached session.
    applyStreamingBatchDesign({ sessionId, toolCallId, operations: script });
    expect(sceneState().parentById.rect1).toBeNull();

    // The user now hits Stop. Before the fix, `abandonProgressiveBatchSession`
    // only tried `rollbackIfSafe`, which always returns false for a detached
    // session — so nothing ran and every node the stream created (Card,
    // StreamBox) stayed on the canvas forever with no undo entry.
    abandonProgressiveBatchSession(sessionId, toolCallId);

    expect(Object.values(sceneState().nodesById).some((n) => n.name === "Card")).toBe(false);
    expect(Object.values(sceneState().nodesById).some((n) => n.name === "StreamBox")).toBe(false);
    // The foreign move must have survived — abandon must not have rolled
    // back over it.
    expect(sceneState().parentById.rect1).toBeNull();
    expect(sceneState().rootIds).toContain("rect1");
    expect(sceneState().childrenById.frame1 ?? []).not.toContain("rect1");
  });

  it("a detached session whose streamed prefix already deleted a node recovers instead of failing the whole batch (third review finding 2)", async () => {
    // A script mixing I() and D() — the D() targets a node that exists
    // before the batch (rect2, a root node), not something the batch itself
    // created, so it's a genuine "this target was already consumed" case
    // rather than a create/delete-in-the-same-script wash.
    const streamedScript =
      'nodeA=I(document, {type: "frame", name: "NodeA", width: 10, height: 10})\n' +
      'D("rect2")\n';

    applyStreamingBatchDesign({ sessionId, toolCallId, operations: streamedScript });
    expect(Object.values(sceneState().nodesById).some((n) => n.name === "NodeA")).toBe(true);
    expect(sceneState().nodesById.rect2).toBeUndefined();

    // Foreign edit — rolling back would erase it, so the next frame must
    // detach rather than restore.
    const live = sceneState();
    useSceneStore.setState({
      nodesById: {
        ...live.nodesById,
        frame1: { ...live.nodesById.frame1, name: "RenamedByForeignEdit" } as FlatFrameNode,
      },
    });

    // One more frame with the same script — trips the foreign-mutation
    // guard and forks a detached session.
    applyStreamingBatchDesign({ sessionId, toolCallId, operations: streamedScript });
    expect(sceneState().nodesById.frame1?.name).toBe("RenamedByForeignEdit");

    // Final call: a script that decode-reshaped (different name/size for
    // nodeA) but still deletes rect2 — this diverges from `appliedRaw`, so
    // the top-level "prefix does not match" fallthrough runs. Detached means
    // rollback is unsafe, so before the fix `runFreshFromLive` would
    // re-execute `D("rect2")` against a live store that no longer has rect2
    // and return a hard execution error, stranding the already-applied
    // deletion with nothing describing it.
    const finalScript =
      'nodeA=I(document, {type: "frame", name: "NodeADifferent", width: 20, height: 20})\n' +
      'D("rect2")\n';

    const result = JSON.parse(
      await batchDesign({ operations: finalScript }, { sessionId, toolCallId }),
    );

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    // The foreign edit survived.
    expect(sceneState().nodesById.frame1?.name).toBe("RenamedByForeignEdit");
    // rect2 stays deleted — not resurrected, not double-deleted (no throw).
    expect(sceneState().nodesById.rect2).toBeUndefined();
    // Exactly one frame node from this script, under its FINAL name — not
    // the stale streamed one, and not duplicated.
    const nodeAs = Object.values(sceneState().nodesById).filter(
      (n) => n.name === "NodeA" || n.name === "NodeADifferent",
    );
    expect(nodeAs).toHaveLength(1);
    expect(nodeAs[0].name).toBe("NodeADifferent");
  });

  it("kill switch off: no session is created, and the final call behaves exactly like today", async () => {
    globalThis.localStorage.setItem("pen.streamingMutations", "off");

    const script = 'card=I(document, {type: "frame", name: "Card", width: 100, height: 100})\n';

    applyStreamingBatchDesign({ sessionId, toolCallId, operations: script });
    // Nothing should have landed yet — the kill switch disables streaming
    // entirely, so no progressive write happens.
    expect(Object.values(sceneState().nodesById).some((n) => n.name === "Card")).toBe(false);

    const result = JSON.parse(await batchDesign({ operations: script }, { sessionId, toolCallId }));
    expect(result.success).toBe(true);
    expect(Object.values(sceneState().nodesById).filter((n) => n.name === "Card")).toHaveLength(1);
  });
});
