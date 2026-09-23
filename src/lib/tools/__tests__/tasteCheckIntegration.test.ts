/**
 * Handler-side half of the taste-check flow. The check itself now runs in
 * the CHAT PATH (useDesignChat.ts's onToolCall, via
 * tasteCheck.ts's runTasteCheckForToolCall) — see
 * src/hooks/__tests__/useDesignChat.test.ts's "Jev taste check" describe
 * block for the chat-path merging behavior. This file only asserts the
 * handler side of the contract: batch_design and edit_embed_html must
 * return EXACTLY what they returned before taste checks existed (no fetch,
 * no awaited network call, unchanged JSON), and must record the right
 * touched embeds in the registry when given a toolCallId.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { batchDesign } from "@/lib/tools/batchDesign";
import { editEmbedHtml } from "@/lib/tools/editEmbedHtml";
import { takeTouchedEmbeds, resetTouchedEmbedsRegistry } from "@/lib/tools/tasteCheckRegistry";
import { useSceneStore } from "@/store/sceneStore";
import { resetStores, seedScene } from "@/test/fixtures";
import type { FlatSceneNode } from "@/types/scene";

function seedEmbed(id: string, htmlContent: string) {
  const node = {
    id,
    type: "embed",
    name: "Screen",
    x: 0,
    y: 0,
    width: 390,
    height: 844,
    htmlContent,
  } as unknown as FlatSceneNode;
  const state = useSceneStore.getState();
  useSceneStore.setState({
    nodesById: { ...state.nodesById, [id]: node },
    parentById: { ...state.parentById, [id]: null },
    rootIds: [...state.rootIds, id],
    _cachedTree: null,
  });
}

beforeEach(() => {
  resetStores();
  resetTouchedEmbedsRegistry();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("batch_design — no longer calls the network itself", () => {
  beforeEach(() => seedScene());

  it("never calls fetch, regardless of whether the batch touches an embed", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await batchDesign(
      {
        operations:
          's=I(document, {type: "embed", name: "Screen", width: 390, height: 844, htmlContent: "<div>Hi</div>"})',
      },
      { toolCallId: "call-1" },
    );

    expect(JSON.parse(result).success).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("records the created embed's id under the call's toolCallId", async () => {
    const result = await batchDesign(
      {
        operations:
          's=I(document, {type: "embed", name: "Screen", width: 390, height: 844, htmlContent: "<div>Hi</div>"})',
      },
      { toolCallId: "call-2" },
    );
    const createdId = JSON.parse(result).createdNodes[0].id as string;

    // I() both touches AND creates — see `ExecutionContext.createdEmbedIds`.
    expect(takeTouchedEmbeds("call-2")).toEqual({ touched: [createdId], created: [createdId] });
  });

  it("records nothing when the batch touches no embeds", async () => {
    await batchDesign(
      { operations: 'r=I(document, {type: "rectangle", name: "R", width: 10, height: 10})' },
      { toolCallId: "call-3" },
    );
    expect(takeTouchedEmbeds("call-3")).toEqual({ touched: [], created: [] });
  });

  it("records nothing without a toolCallId (MCP/WebMCP/plugin callers)", async () => {
    const result = await batchDesign({
      operations:
        's=I(document, {type: "embed", name: "Screen", width: 390, height: 844, htmlContent: "<div>Hi</div>"})',
    });
    expect(JSON.parse(result).success).toBe(true);
    // Nothing to take back — there was never a toolCallId to record under.
    expect(takeTouchedEmbeds(undefined)).toEqual({ touched: [], created: [] });
  });

  it("records the updated embed's id as touched but NOT created when a batch updates htmlContent on an existing embed", async () => {
    seedEmbed("e1", "<div>Old</div>");
    const result = await batchDesign(
      { operations: 'U("e1", {htmlContent: "<div>New</div>"})' },
      { toolCallId: "call-4" },
    );
    expect(JSON.parse(result).success).toBe(true);
    // A bare U() edits an embed it didn't create — `runTasteCheckForToolCall`
    // (tasteCheck.ts) relies on `created` being empty here to keep this from
    // ever starting a check on an embed the agent never generated.
    expect(takeTouchedEmbeds("call-4")).toEqual({ touched: ["e1"], created: [] });
  });

  it("records a C() copy of an embed as touched but NOT created", async () => {
    // A copy is never a "creation" for taste-check purposes, whether it
    // copies the user's own hand-authored screen (must not start a check)
    // or one the agent already generated and had checked (must not reset
    // its round counter) — see executor.ts's `executeCopy` doc comment.
    seedEmbed("e1", "<div>Original</div>");
    const result = await batchDesign(
      { operations: 'c=C("e1", document)' },
      { toolCallId: "call-copy" },
    );
    const copiedId = JSON.parse(result).createdNodes[0].id as string;
    expect(takeTouchedEmbeds("call-copy")).toEqual({ touched: [copiedId], created: [] });
  });

  it("does not record anything when the batch fails entirely", async () => {
    const result = await batchDesign(
      { operations: 'U("does-not-exist", {x: 10})' },
      { toolCallId: "call-5" },
    );
    expect(JSON.parse(result).error).toBeTruthy();
    expect(takeTouchedEmbeds("call-5")).toEqual({ touched: [], created: [] });
  });

  it("returns the exact same JSON shape as before taste checks existed (no extra fields)", async () => {
    const result = await batchDesign(
      {
        operations:
          's=I(document, {type: "embed", name: "Screen", width: 390, height: 844, htmlContent: "<div>Hi</div>"})',
      },
      { toolCallId: "call-6" },
    );
    const parsed = JSON.parse(result);
    expect(Object.keys(parsed).sort()).toEqual(["createdNodes", "operationsExecuted", "success"].sort());
  });
});

describe("edit_embed_html — no longer calls the network itself", () => {
  it("never calls fetch on a successful edit", async () => {
    seedEmbed("e1", '<button class="cta">Buy</button>');
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await editEmbedHtml(
      { nodeId: "e1", edits: [{ oldString: ">Buy<", newString: ">Get started<" }] },
      { toolCallId: "call-1" },
    );

    expect(JSON.parse(result).editsApplied).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("records the node id under the call's toolCallId on success", async () => {
    seedEmbed("e1", '<button class="cta">Buy</button>');
    await editEmbedHtml(
      { nodeId: "e1", edits: [{ oldString: ">Buy<", newString: ">Get started<" }] },
      { toolCallId: "call-2" },
    );
    // edit_embed_html never creates embeds — `created` is always empty.
    expect(takeTouchedEmbeds("call-2")).toEqual({ touched: ["e1"], created: [] });
  });

  it("does not record anything when the edit itself fails (no valid anchor)", async () => {
    seedEmbed("e1", "<p>hi</p>");
    const result = await editEmbedHtml(
      { nodeId: "e1", edits: [{ oldString: "nope", newString: "x" }] },
      { toolCallId: "call-3" },
    );
    expect(JSON.parse(result).error).toBeTruthy();
    expect(takeTouchedEmbeds("call-3")).toEqual({ touched: [], created: [] });
  });

  it("returns the exact same JSON shape as before taste checks existed (no extra fields)", async () => {
    seedEmbed("e1", '<button class="cta">Buy</button>');
    const result = await editEmbedHtml(
      { nodeId: "e1", edits: [{ oldString: ">Buy<", newString: ">Get started<" }] },
      { toolCallId: "call-4" },
    );
    const parsed = JSON.parse(result);
    expect(Object.keys(parsed).sort()).toEqual(
      ["editsApplied", "htmlLength", "issues", "nodeId", "normalizedMatches", "replacements"].sort(),
    );
  });
});
