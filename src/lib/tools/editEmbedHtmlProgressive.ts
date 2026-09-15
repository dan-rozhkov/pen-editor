/**
 * Progressive ("brush by brush") application of `edit_embed_html` while its
 * tool input is still streaming.
 *
 * Design: docs/superpowers/specs/2026-09-13-streaming-tool-mutations-design.md
 * ("3. `edit_embed_html` — progressive re-derivation").
 *
 * A session is keyed by `${sessionId}:${toolCallId}` and lives only for the
 * lifetime of one streaming tool call. Every frame RE-DERIVES the embed's
 * html from the pristine, first-seen original — never accumulates on top of
 * a previous frame's output — because a partial-JSON decode can hand us a
 * `newString` that grows, shrinks, or gets re-parsed differently on the next
 * delta. Re-deriving from scratch means a truncated frame can never leave a
 * trace once a later, more-complete frame lands.
 *
 * No `saveHistory` ever happens here: streaming must never create an undo
 * entry. `editEmbedHtml.ts`'s final handler is the only place a real commit
 * (with history) happens, and it restores the pristine html first so its
 * strict validation/lint/`<c-*>` re-expansion path sees exactly what it sees
 * without streaming.
 */

import { useSceneStore } from "@/store/sceneStore";
import { applyAnchorEdits, type AnchorEdit } from "@/lib/embedHtmlEdit/applyAnchorEdits";
import { parseAnchorEditsInput } from "@/lib/embedHtmlEdit/parseEdits";
import { isStreamingMutationsEnabled } from "@/lib/streamingTools/types";
import type { EmbedNode, FlatSceneNode } from "@/types/scene";

export interface ProgressiveEmbedHtmlSession {
  nodeId: string;
  /** Pristine `htmlContent` at the first usable frame — also the re-derivation base for every
   * frame, restored before the strict path / on abandon. */
  originalHtmlContent: string;
  /** `nodesById` reference last written by this session, for the whole-store foreign-mutation
   * guard used to decide whether streaming should keep applying further frames. */
  lastCommittedNodesById: Record<string, FlatSceneNode> | null;
  /** `htmlContent` last written by this session for `nodeId` specifically. Used by
   * `editEmbedHtml.ts`'s final handler to decide whether a restore is safe: the whole-store
   * guard above is too broad for that decision (an unrelated write elsewhere flips it even
   * though nobody touched this node), so the final handler compares this node's OWN html
   * instead of the whole-store reference. */
  lastCommittedHtmlContent: string | null;
  status: "attached" | "detached";
}

interface ApplyStreamingEmbedHtmlEditsArgs {
  sessionId: string;
  toolCallId: string;
  /** Partial-JSON-parsed tool input as of this delta: `{ nodeId?, edits? }`. */
  input: Record<string, unknown>;
}

const sessions = new Map<string, ProgressiveEmbedHtmlSession>();
// Keys that have been taken/abandoned/cleared: a late-arriving frame for a
// call that already finalized must never resurrect a session (same lesson
// as the vector preview's `finalizedKeys`).
const finalizedKeys = new Set<string>();

function keyOf(sessionId: string, toolCallId: string): string {
  return `${sessionId}:${toolCallId}`;
}

/**
 * A raw `edits` array entry usable for a lenient, re-derived apply. The final
 * handler also accepts `edits` as a JSON string, but a partially-decoded JSON
 * string mid-stream is not parseable — only try to parse it when it parses
 * cleanly, otherwise this frame has nothing usable (handled by
 * `parseAnchorEditsInput` itself, which returns null on a parse failure).
 */
function coerceEdits(raw: unknown): AnchorEdit[] | null {
  return parseAnchorEditsInput(raw, { lenient: true });
}

function isEmbedNode(node: FlatSceneNode | undefined): node is FlatSceneNode & EmbedNode {
  return node !== undefined && node.type === "embed";
}

/** One frame of partial `edit_embed_html` input. Never throws. */
export function applyStreamingEmbedHtmlEdits({
  sessionId,
  toolCallId,
  input,
}: ApplyStreamingEmbedHtmlEditsArgs): void {
  try {
    if (!isStreamingMutationsEnabled()) return;

    const key = keyOf(sessionId, toolCallId);
    if (finalizedKeys.has(key)) return;

    const nodeId = typeof input.nodeId === "string" ? input.nodeId : "";
    if (!nodeId) return;

    const editsInput = coerceEdits(input.edits);
    if (editsInput === null) return;

    let session = sessions.get(key);
    const live = useSceneStore.getState();

    if (!session) {
      // First usable frame: it must resolve to an existing embed node, or
      // there is nothing to snapshot yet — wait for a later frame instead
      // of creating a session against the wrong thing.
      const node = live.nodesById[nodeId];
      if (!isEmbedNode(node)) return;
      const embed = node as unknown as EmbedNode;

      session = {
        nodeId,
        originalHtmlContent: embed.htmlContent,
        lastCommittedNodesById: null,
        lastCommittedHtmlContent: null,
        status: "attached",
      };
      sessions.set(key, session);
    }

    // Foreign-mutation guard: if the live store no longer holds the exact
    // `nodesById` object we last wrote, someone else mutated the scene in
    // between frames. Stop writing for this call — do NOT roll back, that
    // would destroy whatever they wrote.
    if (session.lastCommittedNodesById !== null && live.nodesById !== session.lastCommittedNodesById) {
      session.status = "detached";
    }
    if (session.status === "detached") return;

    const node = live.nodesById[session.nodeId];
    if (!isEmbedNode(node)) return;

    const result = applyAnchorEdits(session.originalHtmlContent, editsInput, { lenient: true });

    if (result.html === node.htmlContent) {
      // Common on the leading edge of a stream: a still-truncated `edits`
      // array (e.g. `{"nodeId":"abc1234","edits":[`) lenient-parses to `[]`,
      // so re-deriving from `originalHtmlContent` reproduces exactly what the
      // node already holds — the pristine original on the very first frames,
      // or an earlier frame's committed output later on. Writing that back
      // would still trigger pixiSync's dirty-tracking full-scan fallback for
      // zero visual change, up to ~20 times/second for the whole leading
      // portion of a long tool call. Skip the store write entirely.
      //
      // Deliberately leave `lastCommittedNodesById`/`lastCommittedHtmlContent`
      // untouched: they already describe reality correctly either way — both
      // still null (no successful streamed write has ever happened, so a
      // later abandon/restore correctly treats the node as never touched by
      // this session), or both already pointing at this exact content from a
      // prior frame's real commit (so a later restore's per-node html
      // comparison still matches and is not mistaken for a foreign edit).
      return;
    }

    const updated = { ...node, htmlContent: result.html } as unknown as FlatSceneNode;
    const newNodesById: Record<string, FlatSceneNode> = {
      ...live.nodesById,
      [session.nodeId]: updated,
    };

    useSceneStore.setState({ nodesById: newNodesById, _cachedTree: null });
    session.lastCommittedNodesById = newNodesById;
    session.lastCommittedHtmlContent = result.html;
  } catch {
    // A streaming preview frame must never throw into the chat/UI pipeline.
  }
}

/** Remove and return a session, permanently finalizing the key. */
export function takeProgressiveEmbedHtmlSession(
  sessionId: string,
  toolCallId: string,
): ProgressiveEmbedHtmlSession | undefined {
  const key = keyOf(sessionId, toolCallId);
  const session = sessions.get(key);
  sessions.delete(key);
  finalizedKeys.add(key);
  return session;
}

export interface RestoreProgressiveSessionResult {
  /** Whether `session`'s node was restored to `originalHtmlContent`. */
  restored: boolean;
  /** True when this node's own html changed since the session's last streamed
   * write, which is why it was NOT restored (that write would be destroyed). */
  conflicted: boolean;
}

/**
 * Restores `session`'s node back to its pristine pre-stream html where safe,
 * else reports a conflict without touching the store. Shared by the
 * abandon/clear path below and by `editEmbedHtml.ts`'s final handler so the
 * two can never disagree on what "safe to restore" means.
 *
 * Safety is judged per-node (`htmlContent` value), NOT by whole-store
 * `nodesById` reference identity: the whole-store reference changes on
 * EVERY scene write, including an unrelated node, a concurrent progressive
 * session's own commit, or even this node being re-spread with byte-identical
 * content — none of those should block restoring this node. Only a genuine
 * change to THIS node's own html since the session's last streamed write
 * should, since restoring over it would destroy that edit. Comparing values
 * instead of the store reference gets that right in both directions.
 */
export function restoreProgressiveSessionHtml(
  session: ProgressiveEmbedHtmlSession,
): RestoreProgressiveSessionResult {
  if (session.lastCommittedHtmlContent === null) {
    return { restored: false, conflicted: false }; // no successful streamed frame ever wrote anything
  }

  const live = useSceneStore.getState();
  const node = live.nodesById[session.nodeId];
  if (!isEmbedNode(node)) return { restored: false, conflicted: false }; // node gone/retyped

  const embed = node as unknown as EmbedNode;
  if (embed.htmlContent !== session.lastCommittedHtmlContent) {
    // Someone changed this exact node's html after our last streamed write —
    // restoring now would destroy their edit, so leave it in place.
    return { restored: false, conflicted: true };
  }

  const restored = {
    ...embed,
    htmlContent: session.originalHtmlContent,
  } as unknown as FlatSceneNode;
  useSceneStore.setState({
    nodesById: { ...live.nodesById, [session.nodeId]: restored },
    _cachedTree: null,
  });
  return { restored: true, conflicted: false };
}

/** Restore original html where safe, then finalize the key. */
function restoreAndFinalize(key: string, session: ProgressiveEmbedHtmlSession): void {
  sessions.delete(key);
  finalizedKeys.add(key);
  restoreProgressiveSessionHtml(session);
}

/**
 * The call will never complete (abort/error/unmount): restore where safe,
 * finalize the key. This is a `StreamingToolAdapter#onAbandon` — the adapter
 * contract requires it never throw (`useDesignChat`'s abort handler and
 * unmount cleanup call it unconditionally), so wrap it like its
 * `batch_design` counterpart (`abandonProgressiveBatchSession`).
 */
export function abandonProgressiveEmbedHtmlSession(sessionId: string, toolCallId: string): void {
  try {
    const key = keyOf(sessionId, toolCallId);
    const session = sessions.get(key);
    if (!session) {
      finalizedKeys.add(key);
      return;
    }
    restoreAndFinalize(key, session);
  } catch {
    // Cleanup paths (unmount/abort handlers) must never throw.
  }
}

/**
 * Drop every session belonging to a chat session (e.g. on chat reset/unmount).
 * Same `onSessionClear` contract as above — never throw.
 */
export function clearProgressiveEmbedHtmlSessions(sessionId: string): void {
  try {
    const prefix = `${sessionId}:`;
    for (const [key, session] of sessions) {
      if (key.startsWith(prefix)) {
        restoreAndFinalize(key, session);
      }
    }
  } catch {
    // Cleanup paths (unmount/abort handlers) must never throw.
  }
}
