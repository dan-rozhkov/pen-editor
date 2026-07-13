import { useState } from "react";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";
import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";
import { useActiveSlideId } from "@/hooks/useActiveSlideId";
import { useReadOnly } from "@/hooks/useReadOnly";
import type { FlatFrameNode } from "@/types/scene";

/**
 * Speaker notes for the currently selected slide, rendered as a card
 * visually merged with `PrimitivesPanel` (stacked directly above it — see
 * that component's render). Only shown when the Slides section is active;
 * scoped to the editor only (not shown in Present mode / exports).
 *
 * The textarea is fully controlled by the scene store (no separate local
 * draft state) — `setSpeakerNotesWithoutHistory` writes on every keystroke.
 * History: mirrors `InlineTextEditor` — one `saveHistory` snapshot is taken
 * when the textarea gains focus, so the whole typing session (many
 * without-history writes) collapses into a single undo step.
 */
export function SpeakerNotesCard() {
  const activeSection = useLeftSidebarStore((s) => s.activeSection);
  const activeSlideId = useActiveSlideId();
  const speakerNotes = useSceneStore((s) =>
    activeSlideId
      ? (s.nodesById[activeSlideId] as FlatFrameNode | undefined)?.speakerNotes
      : undefined,
  );
  const setSpeakerNotesWithoutHistory = useSceneStore(
    (s) => s.setSpeakerNotesWithoutHistory,
  );
  const readOnly = useReadOnly();

  // Which slide (if any) already got its one-time pre-edit `saveHistory`
  // snapshot for the current edit session — compared against `activeSlideId`
  // rather than a plain boolean so switching slides mid-session doesn't
  // suppress the next slide's first snapshot.
  const [historyStartedForSlideId, setHistoryStartedForSlideId] = useState<
    string | null
  >(null);

  if (activeSection !== "slides") return null;

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!activeSlideId) return;
    // Take the single pre-edit snapshot lazily on the first real keystroke —
    // NOT on focus. `saveHistory` clears the redo stack, so snapshotting on
    // focus would wipe redo just because the user clicked into the field
    // without editing. Gated by the slide id so the rest of the typing
    // session collapses into this one undo step.
    if (historyStartedForSlideId !== activeSlideId) {
      setHistoryStartedForSlideId(activeSlideId);
      useHistoryStore.getState().saveHistory(createSnapshot(useSceneStore.getState()));
    }
    setSpeakerNotesWithoutHistory(activeSlideId, event.target.value);
  };

  const handleBlur = () => {
    setHistoryStartedForSlideId(null);
  };

  return (
    <div className="w-[calc(100%-2rem)] max-w-[560px] pointer-events-auto bg-surface-panel border border-border-default rounded-2xl shadow-[0_0px_3px_rgba(0,0,0,0.04)]">
      {activeSlideId ? (
        <textarea
          data-testid="speaker-notes-textarea"
          value={speakerNotes ?? ""}
          onChange={handleChange}
          onBlur={handleBlur}
          disabled={readOnly}
          placeholder="Speaker notes…"
          rows={2}
          className="w-full resize-none bg-transparent px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none disabled:cursor-not-allowed disabled:opacity-60"
        />
      ) : (
        <div className="px-3 py-2 text-sm text-text-muted">Select a slide to add notes.</div>
      )}
    </div>
  );
}
