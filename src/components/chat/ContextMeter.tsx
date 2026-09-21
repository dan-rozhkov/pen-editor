import { useChatStore } from "@/store/chatStore";
import { getModelContextWindow } from "@/lib/chatModels";
import { contextFillPercent, contextMeterLabel } from "@/lib/contextMeter";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

// Sits inside the same 30px composer-control box as the neighboring
// IconButtons (ChatPanel.tsx's composerControls), sized down to leave a
// visible ring of padding around it.
const BOX_SIZE = 30;
const SVG_SIZE = 16;
const STROKE_WIDTH = 2;
const RADIUS = (SVG_SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const WARNING_THRESHOLD = 75;
const DANGER_THRESHOLD = 90;

/**
 * Small circular indicator of how full the active chat's context window is,
 * shown next to the model picker in the composer. Reads the active chat's
 * model (for its context window, chatModels.ts) and its last reported
 * `contextTokens` (chatStore, set from useDesignChat's onFinish) directly
 * from the store — no props, since composerControls is shared across every
 * ChatSession but only ever rendered for the active one.
 *
 * Renders nothing until both are known: an unsized model, or a chat that
 * hasn't completed a turn yet, has nothing honest to show.
 */
export function ContextMeter() {
  const activeChatId = useChatStore((s) => s.activeChatId);
  const model = useChatStore((s) => s.model);
  const contextTokens = useChatStore((s) =>
    activeChatId ? s.contextTokens[activeChatId] : undefined,
  );

  const contextWindow = getModelContextWindow(model);

  if (!contextWindow || !contextTokens) {
    return null;
  }

  const percent = contextFillPercent(contextTokens, contextWindow);
  const label = contextMeterLabel(contextTokens, contextWindow);
  const arcColorClass =
    percent >= DANGER_THRESHOLD
      ? "text-destructive"
      : percent >= WARNING_THRESHOLD
        ? "text-amber-500"
        : "text-text-muted";
  const dashOffset = CIRCUMFERENCE * (1 - percent / 100);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          /* `tabIndex` is load-bearing, not decoration: the numeric
             reading exists only in the tooltip, so without a tab stop it is
             hover-only — unreachable by keyboard and on the mobile chat
             panel. A span rather than a button because there is nothing to
             activate (and a button inside the composer form would need
             type="button" to avoid submitting it). */
          <span
            role="img"
            aria-label={label}
            data-testid="context-meter"
            tabIndex={0}
            className="flex shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-ring/30 focus-visible:ring-[2px]"
            style={{ width: BOX_SIZE, height: BOX_SIZE }}
          >
            <svg
              width={SVG_SIZE}
              height={SVG_SIZE}
              viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
              className="-rotate-90"
              aria-hidden="true"
            >
              <circle
                cx={SVG_SIZE / 2}
                cy={SVG_SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke="currentColor"
                strokeWidth={STROKE_WIDTH}
                className="text-text-muted/25"
              />
              <circle
                cx={SVG_SIZE / 2}
                cy={SVG_SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke="currentColor"
                strokeWidth={STROKE_WIDTH}
                strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={dashOffset}
                // The transition lives in this utility class, not an inline
                // style, so `motion-reduce:transition-none` can actually
                // override it — an inline `transition` property always wins
                // over a stylesheet rule regardless of specificity, which
                // would defeat the reduced-motion preference entirely (see
                // root CLAUDE.md's "Инлайн-стиль перебивает motion-reduce").
                className={`${arcColorClass} transition-[stroke-dashoffset] duration-250 ease-smooth-out motion-reduce:transition-none`}
              />
            </svg>
          </span>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
