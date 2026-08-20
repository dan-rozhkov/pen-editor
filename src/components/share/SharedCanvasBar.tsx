import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { forkSharedCanvasInPlace } from "@/lib/shareCanvas";
import { useShareStore } from "@/store/shareStore";
import { track } from "@/lib/analytics";
import { Button } from "@/components/ui/button";

interface SharedCanvasBarProps {
  title: string;
  shareId: string;
}

/**
 * Slim read-only bar pinned above the canvas in the `/c/:shareId` viewer.
 * Positioned/pointer-events the same way OfflineBanner/StatusPill are: the
 * outer wrapper is pointer-events-none so it never steals canvas input
 * outside its own box, only the pill itself opts back in.
 */
export function SharedCanvasBar({ title, shareId }: SharedCanvasBarProps) {
  const navigate = useNavigate();

  const handleCopy = () => {
    forkSharedCanvasInPlace(title);
    // The store hydrated the *previous* document's (this shared canvas')
    // credentials at import time — clear them so the forker doesn't see a
    // "shared" link they don't own the moment they land in the editor.
    useShareStore.getState().reset();
    void navigate("/app");
    toast("Copied to a new canvas — it's yours to edit.");
    track("shared_canvas_forked", { share_id: shareId });
  };

  return (
    <div
      data-testid="shared-canvas-bar"
      className="absolute top-2 inset-x-0 z-50 flex justify-center pointer-events-none px-2"
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border-default bg-surface-panel px-3 py-1.5 text-xs text-text-default shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
        <span className="max-w-[40vw] truncate font-medium">{title}</span>
        <span className="text-text-muted">View only</span>
        <Button size="sm" onClick={handleCopy}>
          Make a copy
        </Button>
        <Link
          to="/app"
          className="text-text-muted hover:text-text-default hover:underline"
        >
          Open editor
        </Link>
      </div>
    </div>
  );
}
