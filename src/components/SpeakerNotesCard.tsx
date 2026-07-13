import { useState } from "react";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";
import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";
import { useActiveSlideId } from "@/hooks/useActiveSlideId";
import { useReadOnly } from "@/hooks/useReadOnly";
import type { FlatFrameNode } from "@/types/scene";
import { NoteIcon } from "@phosphor-icons/react";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * Speaker notes for the currently selected slide, rendered in a draggable
 * popover opened from the tools bar. Only shown when the Slides section is
 * active and a slide is selected; scoped to the editor only.
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
  if (!activeSlideId) return null;

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
    <Popover>
      <Tooltip>
        <TooltipTrigger render={<span className="flex" />}>
          <PopoverTrigger>
            <Button
              variant="ghost"
              size="lg"
              aria-label="Speaker notes"
              className="group relative size-9 p-0 rounded-lg! transition-none outline-none text-text-primary hover:text-text-primary hover:bg-secondary dark:hover:bg-secondary"
            >
              <NoteIcon size={40} className="size-6" weight="light" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">Speaker notes</TooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        align="center"
        className="w-[320px]"
        draggable
        dragHandleContent={<span className="text-[11px] font-semibold text-text-primary">Speaker notes</span>}
      >
        <textarea
          data-testid="speaker-notes-textarea"
          value={speakerNotes ?? ""}
          onChange={handleChange}
          onBlur={handleBlur}
          disabled={readOnly}
          placeholder="Speaker notes…"
          rows={2}
          className="min-h-24 w-full resize-y rounded-md bg-secondary/50 px-2.5 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:ring-1 focus:ring-accent-primary disabled:cursor-not-allowed disabled:opacity-60"
        />
      </PopoverContent>
    </Popover>
  );
}
