import { useContext } from "react";
import { HeartIcon } from "@phosphor-icons/react";
import { useChatStore } from "@/store/chatStore";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { ChatSessionIdContext } from "./ChatSessionContext";

const EMPTY: readonly never[] = [];

/** data: URLs are too large to ride along in canvasContext; only link out. */
function isLikeableUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export interface LikeMeta {
  sourceUrl?: string;
  tool?: string;
}

interface LikeReferenceButtonProps extends LikeMeta {
  url: string;
  /** "thumb" sits on a hover-revealed thumbnail; "lightbox" on the big view. */
  variant?: "thumb" | "lightbox";
}

export function LikeReferenceButton({
  url,
  sourceUrl,
  tool,
  variant = "thumb",
}: LikeReferenceButtonProps) {
  const sessionId = useContext(ChatSessionIdContext);
  const activeChatId = useChatStore((s) => s.activeChatId);
  const chatId = sessionId ?? activeChatId;
  const liked = useChatStore((s) =>
    chatId ? (s.likedReferences[chatId] ?? EMPTY).some((r) => r.url === url) : false,
  );
  const toggle = useChatStore((s) => s.toggleLikedReference);

  if (!chatId || !isLikeableUrl(url)) return null;

  const label = liked ? "Unlike reference" : "Like reference";
  const position =
    variant === "thumb" ? "absolute top-1 left-1 p-1" : "absolute top-4 right-4 p-2";
  const visibility =
    variant === "thumb" && !liked
      ? "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      : "opacity-100";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggle(chatId, {
                url,
                ...(sourceUrl ? { sourceUrl } : {}),
                ...(tool ? { tool } : {}),
              });
            }}
            aria-label={label}
            aria-pressed={liked}
            className={`${position} ${visibility} rounded bg-black/60 hover:bg-black/80 transition-opacity ${
              liked ? "text-[var(--color-accent-primary)]" : "text-white"
            }`}
          >
            <HeartIcon size={variant === "thumb" ? 12 : 20} weight={liked ? "fill" : "regular"} />
          </button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
