import { useState } from "react";
import { ImageBrokenIcon, XIcon } from "@phosphor-icons/react";
import { useChatStore } from "@/store/chatStore";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

const EMPTY: readonly never[] = [];

function Thumb({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="w-full h-full bg-surface-panel text-text-muted flex items-center justify-center">
        <ImageBrokenIcon size={16} />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt="Liked reference"
      onError={() => setFailed(true)}
      className="w-full h-full object-cover"
    />
  );
}

/** Composer strip: the chat's liked references, each removable. */
export function LikedReferencesStrip({ sessionId }: { sessionId: string }) {
  const refs = useChatStore((s) => s.likedReferences[sessionId] ?? EMPTY);
  const remove = useChatStore((s) => s.removeLikedReference);
  if (refs.length === 0) return null;

  return (
    <div className="mb-2" data-testid="liked-references">
      <div className="mb-1 text-xs text-text-muted">
        Liked references — the agent will use these first
      </div>
      <div className="flex gap-2 flex-wrap">
        {refs.map((ref) => (
          <div
            key={ref.url}
            className="relative group w-12 h-12 rounded-md overflow-hidden img-outline"
          >
            <Thumb url={ref.url} />
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() => remove(sessionId, ref.url)}
                    aria-label="Unlike reference"
                    className="absolute top-0 right-0 p-0.5 bg-black/60 rounded-bl text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                  >
                    <XIcon size={10} />
                  </button>
                }
              />
              <TooltipContent>Unlike reference</TooltipContent>
            </Tooltip>
          </div>
        ))}
      </div>
    </div>
  );
}
