import { useCallback, useEffect, useRef, useState } from "react";
import { SparkleIcon, ArrowUpIcon } from "@phosphor-icons/react";
import { IconButton } from "@/components/ui/IconButton";
import { cn } from "@/lib/utils";
import { useDevModeStore } from "@/store/devModeStore";
import { useViewportStore } from "@/store/viewportStore";
import { embedScreenRect } from "@/components/canvas/embedLayerGeometry";
import {
  FRAME_QUICK_ACTIONS,
  type FrameQuickAction,
} from "@/components/canvas/frameQuickActions";

interface NodeAgentButtonProps {
  node: { id: string; width: number; height: number };
  absoluteX: number;
  absoluteY: number;
  placeholder: string;
  isComponentContext?: boolean;
  launch: (nodeId: string, text: string) => void | Promise<unknown>;
}

/**
 * On-canvas affordance shown at a selected node's top-right corner: a small
 * trigger that opens a composer (text input + send + quick actions). Sending
 * invokes the injected `launch` (frame variant attaches a screenshot; embed
 * variant relies on selection). Positioning mirrors EmbedActionBar — world
 * coordinates are converted to screen space via the viewport transform so the
 * button tracks pan/zoom.
 */
export function NodeAgentButton({
  node,
  absoluteX,
  absoluteY,
  placeholder,
  isComponentContext = false,
  launch,
}: NodeAgentButtonProps) {
  const isDevMode = useDevModeStore((state) => state.active);
  const scale = useViewportStore((s) => s.scale);
  const panX = useViewportStore((s) => s.x);
  const panY = useViewportStore((s) => s.y);
  const dpr = window.devicePixelRatio || 1;

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

  // The parent remounts this component (keyed by node id) when the selected
  // node changes, so composer state resets without a synchronizing effect.
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
    void launch(node.id, trimmed);
    setText("");
    setOpen(false);
  }, [text, node.id, launch]);

  const runQuickAction = useCallback(
    (action: FrameQuickAction) => {
      void launch(node.id, action.prompt);
      setText("");
      setOpen(false);
    },
    [node.id, launch],
  );

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

  if (isDevMode) return null;

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
        <IconButton
          tooltip="Ask agent"
          side="top"
          variant="default"
          size="icon-sm"
          className={cn(
            "size-6 rounded-lg text-white shadow-[0_1px_2px_rgba(0,0,0,0.12)]",
            isComponentContext
              ? "bg-[#8b5cf6] hover:bg-[#8b5cf6]/90"
              : "bg-accent-primary hover:bg-accent-primary/90",
          )}
          onClick={() => setOpen(true)}
        >
          <SparkleIcon className="size-3.5" weight="fill" />
        </IconButton>
      ) : (
        <div className="flex w-72 flex-col gap-1 rounded-xl border border-border-default bg-surface-panel p-1.5 shadow-[0_0px_3px_rgba(0,0,0,0.04)]">
          <div className="flex items-end gap-1.5">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
              placeholder={placeholder}
              className="flex-1 resize-none bg-transparent px-1.5 py-1 text-[13px] text-text-primary outline-none placeholder:text-text-muted"
            />
            <IconButton
              tooltip="Send"
              side="top"
              variant="default"
              size="icon-sm"
              className={cn(
                "size-6 shrink-0 rounded-lg",
                canSend
                  ? "bg-accent-primary text-white hover:bg-accent-primary/90"
                  : "bg-transparent text-text-secondary hover:bg-transparent disabled:opacity-100",
              )}
              disabled={!canSend}
              onClick={submit}
            >
              <ArrowUpIcon className="size-3.5" weight="regular" />
            </IconButton>
          </div>
          {/* Full-bleed divider: negative margins cancel the container padding. */}
          <div className="-mx-1.5 my-0.5 h-px bg-border-default" />
          <ul className="flex flex-col">
            {FRAME_QUICK_ACTIONS.map((action) => {
              const Icon = action.icon;
              return (
                <li key={action.id}>
                  <button
                    type="button"
                    onClick={() => runQuickAction(action)}
                    className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-[13px] text-text-primary hover:bg-secondary"
                  >
                    <Icon
                      className="size-3.5 shrink-0 text-text-muted"
                      weight="regular"
                    />
                    <span className="truncate">{action.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
