import { useCallback, useEffect, useRef, useState } from "react";
import { SparkleIcon, ArrowUpIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import type { FrameNode } from "@/types/scene";
import { useViewportStore } from "@/store/viewportStore";
import { embedScreenRect } from "@/components/canvas/embedLayerGeometry";
import { launchFrameAgentChat } from "@/lib/launchFrameAgentChat";

interface FrameAgentButtonProps {
  node: FrameNode;
  absoluteX: number;
  absoluteY: number;
}

/**
 * On-canvas affordance shown at a selected frame's top-right corner: a small
 * trigger that opens a composer (text input + send). Sending starts a new Design
 * Agent chat seeded by the typed text, with this frame attached as context.
 *
 * Positioning mirrors EmbedActionBar — world coordinates are converted to screen
 * space via the viewport transform so the button tracks pan/zoom.
 */
export function FrameAgentButton({
  node,
  absoluteX,
  absoluteY,
}: FrameAgentButtonProps) {
  const scale = useViewportStore((s) => s.scale);
  const panX = useViewportStore((s) => s.x);
  const panY = useViewportStore((s) => s.y);
  const dpr = window.devicePixelRatio || 1;

  // Same device-pixel-snapped world→screen mapping the embed overlays use.
  const rect = embedScreenRect(
    absoluteX,
    absoluteY,
    node.width,
    node.height,
    scale,
    panX,
    panY,
    dpr,
  );

  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // The parent remounts this component (keyed by frame id) when the selected
  // frame changes, so composer state resets without a synchronizing effect.
  useEffect(() => {
    if (open) textareaRef.current?.focus();
  }, [open]);

  const stopCanvasPointer = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
  }, []);

  const canSend = text.trim().length > 0;

  const submit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    void launchFrameAgentChat(node.id, trimmed);
    setText("");
    setOpen(false);
  }, [text, node.id]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    },
    [submit],
  );

  return (
    <div
      className="absolute z-20"
      style={{
        left: rect.left + rect.width,
        top: rect.top,
        transform: "translate(8px, 0)",
      }}
      onPointerDown={stopCanvasPointer}
    >
      {!open ? (
        <Button
          variant="default"
          size="icon-sm"
          className="size-6 rounded-lg bg-accent-primary text-white shadow-[0_1px_2px_rgba(0,0,0,0.12)] hover:bg-accent-primary/90"
          title="Ask agent"
          aria-label="Ask agent"
          onClick={() => setOpen(true)}
        >
          <SparkleIcon className="size-3.5" weight="fill" />
        </Button>
      ) : (
        <div className="flex w-72 items-end gap-1.5 rounded-xl border border-border-default bg-surface-panel/95 p-1.5 shadow-[0_0px_3px_rgba(0,0,0,0.04)]">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            placeholder="Ask the agent about this frame…"
            className="flex-1 resize-none bg-transparent px-1.5 py-1 text-[13px] text-text-primary outline-none placeholder:text-text-muted"
          />
          <Button
            variant="default"
            size="icon-sm"
            className="size-5 shrink-0 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90"
            title="Send"
            aria-label="Send"
            disabled={!canSend}
            onClick={submit}
          >
            <ArrowUpIcon className="size-3" weight="regular" />
          </Button>
        </div>
      )}
    </div>
  );
}
