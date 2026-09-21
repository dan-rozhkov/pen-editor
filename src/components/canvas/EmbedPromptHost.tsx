import { useCallback, useEffect, useRef, useState } from "react";
import { PaperPlaneRightIcon } from "@phosphor-icons/react";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useEditorModeStore, canEditScene } from "@/store/editorModeStore";
import { useDevModeStore } from "@/store/devModeStore";
import { launchEmbedAgentChat } from "@/lib/launchEmbedAgentChat";
import { useOverlayHostRect } from "./useOverlayHostRect";
import { findPixiCanvasFrom, redispatchWheelAt } from "./forwardWheelToPixiCanvas";

/**
 * Minimum content box the composer card needs to render usably: the card
 * itself is roughly 45px tall (textarea row + send button + card padding),
 * and the host applies 16px of padding on every side (32px total) around
 * it — so anything shorter than that combined floor would clip the card.
 * Width is a conservative floor that still fits the placeholder text and
 * send button without awkward wrapping (the card's own `maxWidth` is 420).
 * Below either floor the embed just renders empty, as it did before this
 * feature existed — the on-canvas `EmbedAgentButton` still offers the agent
 * once the node (or its selection) makes that button available.
 */
const MIN_COMPOSER_WIDTH = 180;
const MIN_COMPOSER_HEIGHT = 72;

/**
 * On-canvas overlay for an EMPTY embed node: a prompt composer that looks
 * like the design-agent chat composer (`ChatInput`/`ChatPanel`), rendered
 * directly inside the embed's frame. Submitting starts a new agent chat
 * scoped to this embed with the typed text as the first message
 * (`launchEmbedAgentChat`); once the agent fills the embed with real HTML,
 * `EmbedLayer` swaps this host out for the ordinary `EmbedHost` on its own
 * (no dismiss affordance is needed here).
 *
 * This is a SEPARATE component from `EmbedHost`, not a branch inside it,
 * because `EmbedHost` attaches a shadow root to its host div to mount
 * `htmlContent` in isolation from the page's own styles — and a shadow root,
 * once attached to an element, can never be detached. Reusing that host div
 * for the composer would mean either living with an (empty, but permanent)
 * shadow root under a plain React-rendered composer, or minting a second DOM
 * node to dodge it. A dedicated component with its own plain host div is
 * simpler than either: normal Tailwind-styled React markup, no shadow DOM
 * surprises, and `EmbedLayer` just picks one component or the other per node
 * (see the comment there).
 */
export function EmbedPromptHost({ nodeId }: { nodeId: string }) {
  const node = useSceneStore((s) => s.nodesById[nodeId]);
  const mode = useEditorModeStore((s) => s.mode);
  const isDevMode = useDevModeStore((s) => s.active);

  const hostRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  // Set right after a successful launch, so an impatient user hammering
  // Enter/Send while the agent is still filling the embed (70-120s) can't
  // spawn a second chat session writing to the same node. Re-enabled if the
  // launch itself resolves `false` (see `submit`) — `EmbedLayer` unmounts
  // this component entirely once the agent actually writes `htmlContent`, so
  // there's no other path back to `sending: false` to worry about.
  const [sending, setSending] = useState(false);

  // Imperative, like EmbedHost's own `syncContentScale` — this runs on every
  // pan/zoom tick, so it writes directly to the DOM instead of going through
  // a React re-render.
  const syncContentScale = useCallback((scale: number) => {
    const content = contentRef.current;
    if (!content) return;
    content.style.transform = `scale(${scale})`;
    content.style.transformOrigin = "top left";
  }, []);

  const position = useOverlayHostRect(hostRef, nodeId, syncContentScale);

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  const submit = useCallback(() => {
    if (sending) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    // `launchEmbedAgentChat` -> `launchNodeAgentChat(nodeId, text, {
    // attachScreenshot: false })` never actually reads `nodeId` on that
    // path — with no screenshot to attach, the agent learns which node to
    // work on only from the CURRENT SELECTION carried in `canvasContext`.
    // This composer renders for every empty embed at once (unlike the other
    // callers of `launchNodeAgentChat`, which only render for an
    // already-selected node), and `handlePointerDown` below stops
    // propagation so clicking into it never selects the node on its own —
    // so without this, typing here while a DIFFERENT embed is selected would
    // make the agent write into that other embed instead of this one.
    useSelectionStore.getState().select(nodeId);
    setSending(true);
    const launched = launchEmbedAgentChat(nodeId, trimmed);
    // `launchEmbedAgentChat` returns `Promise<boolean>`; wrap in
    // `Promise.resolve` so this still behaves if a caller/mock returns a
    // plain value instead of a promise.
    Promise.resolve(launched).then((ok) => {
      if (!ok) setSending(false);
    });
    setText("");
    // The textarea shrinks back down on the next render (value goes back to
    // ""), but its inline height was set imperatively by `resize()` above,
    // so it needs an imperative reset too.
    requestAnimationFrame(resize);
  }, [text, nodeId, resize, sending]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      submit();
    },
    [submit],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Shield the textarea from global editor hotkeys (Backspace/Delete
      // would delete this node, letter keys would switch tools, etc). The
      // window-level handler (`useCanvasKeyboardShortcuts`) is bound with
      // `{ capture: true }`, so its capture-phase pass has already run by
      // the time this bubble-phase handler fires — `stopPropagation` here
      // cannot undo that. It doesn't need to, though: that handler already
      // calls `isTypingTarget(e)` on the REAL event target, and since this
      // composer is plain DOM (no shadow root — see this file's module
      // doc), `e.target` is genuinely this `<textarea>`, so the existing
      // input/textarea check already exempts it from nearly every shortcut.
      // `stopPropagation` is still worth doing here defensively, for any
      // bubble-phase listener that might sit between this card and window.
      e.stopPropagation();
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );

  const handleKeyUp = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation();
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Keep a click in the composer from also starting a canvas
    // marquee/drag or clearing selection.
    e.stopPropagation();
  }, []);

  // Present mode, any read-only surface (shared view, `?view`), and Dev/
  // inspect mode all withhold the composer — an empty embed on someone
  // else's read-only canvas, mid-presentation, or while inspecting must not
  // offer a way to start writing to it. `canEditScene(mode)` is the same
  // gate the sibling canvas overlays use (`EmbedAgentButton`/
  // `FrameAgentButton` in `PixiCanvas.tsx`) — it is true only in `edit`
  // mode, which already covers both `present` and `view`/shared-view
  // (`useReadOnly()` is NOT that gate: `EmbedLayer`, and therefore this
  // component, renders outside every `ReadOnlyProvider` in the app, so it
  // always reported `false`). The Dev Mode check mirrors
  // `AgentComposerButton.tsx`'s own `if (isDevMode) return null`.
  //
  // Also withheld for a node too small to hold the card without clipping —
  // see `MIN_COMPOSER_WIDTH`/`MIN_COMPOSER_HEIGHT`'s doc comment.
  const isEmbedNode = node?.type === "embed";
  const showComposer =
    isEmbedNode &&
    canEditScene(mode) &&
    !isDevMode &&
    node.width >= MIN_COMPOSER_WIDTH &&
    node.height >= MIN_COMPOSER_HEIGHT;

  // Wheel forwarding: this card is the only `pointer-events: auto` region
  // over the Pixi canvas for an empty embed, so without this a wheel here
  // would zoom/scroll nothing instead of zooming the canvas underneath.
  // Uses the shared `forwardWheelToPixiCanvas` helper — the same re-dispatch
  // `EmbedLayer` does for its own pointer-events-taking host.
  // Always forwarded, even over the textarea, to keep this simple:
  // the textarea has no scrollable overflow of its own worth preserving.
  //
  // Depends on `showComposer` (not `[]`): the card is only mounted while
  // `showComposer` is true, so a `[]`-deps effect that first ran while it
  // was false (present mode, an undersized node that later resizes, ...)
  // would find `cardRef.current` null, bail, and never run again — leaving
  // that card with no wheel forwarder for the rest of its life. Re-running
  // this effect on the transition also re-syncs the content's scale
  // transform (`position()`), which otherwise stays unset — and the
  // composer visibly flashes at scale 1 — until the next unrelated
  // pan/zoom/layout/scene event happens to fire.
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    position();

    const forwardWheel = (e: WheelEvent) => {
      e.preventDefault();
      const canvas = findPixiCanvasFrom(card);
      if (!canvas) return;
      redispatchWheelAt(canvas, e);
    };

    card.addEventListener("wheel", forwardWheel, { capture: true, passive: false });
    return () => card.removeEventListener("wheel", forwardWheel, true);
  }, [showComposer, position]);

  if (!node || node.type !== "embed") return null;

  return (
    <div
      ref={hostRef}
      data-embed-id={nodeId}
      data-embed-prompt
      style={{
        position: "absolute",
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      {showComposer && (
        <div
          ref={contentRef}
          style={{
            width: node.width,
            height: node.height,
            transformOrigin: "top left",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            boxSizing: "border-box",
          }}
        >
          <div
            ref={cardRef}
            data-agent-composer
            style={{ pointerEvents: "auto", width: "100%", maxWidth: 420 }}
            className="relative overflow-hidden rounded-xl border border-border-default bg-surface-panel shadow-[0_1px_3px_rgba(0,0,0,0.08)] focus-within:border-accent-light"
            onPointerDown={handlePointerDown}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
          >
            {sending ? (
              <div className="px-3.5 py-2.5 text-sm text-text-muted">Working…</div>
            ) : (
              <form onSubmit={handleSubmit} className="relative px-2 pb-1.5 pt-2">
                <div className="flex items-end gap-2">
                  <textarea
                    ref={textareaRef}
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                      resize();
                    }}
                    rows={1}
                    placeholder="Ask the design agent..."
                    disabled={sending}
                    className="flex-1 resize-none bg-transparent pl-2 text-sm text-text-primary placeholder:text-text-disabled outline-none min-h-[29px] max-h-[96px] py-1 leading-normal"
                  />
                  <button
                    type="submit"
                    disabled={!text.trim() || sending}
                    aria-label="Send"
                    className="shrink-0 p-1.5 rounded-lg hover:bg-secondary text-text-muted disabled:text-text-disabled transition-colors"
                  >
                    <PaperPlaneRightIcon size={18} />
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
