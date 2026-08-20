import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { track } from "@/lib/analytics";
import { useShareDialogStore } from "@/store/shareDialogStore";
import { useShareStore } from "@/store/shareStore";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

/**
 * "Share…" dialog: create/update/revoke a public read-only link for the
 * currently open document. Controlled by `shareDialogStore` so both the File
 * menu item (Toolbar.tsx) and the `file-share` palette command
 * (shareCommands.ts) can open the same instance. Network status/URL come
 * from `useShareStore` (owned by the data-layer half of this feature); this
 * component only maps that status to UI and fires the UI-side analytics
 * events (`canvas_shared`/`canvas_unshared` — `shared_canvas_viewed`/
 * `shared_canvas_forked` are fired by the viewer route instead).
 */
export function ShareDialog() {
  const open = useShareDialogStore((s) => s.open);
  const setOpen = useShareDialogStore((s) => s.setOpen);
  const status = useShareStore((s) => s.status);
  const shareUrl = useShareStore((s) => s.shareUrl);
  const error = useShareStore((s) => s.error);

  const urlInputRef = useRef<HTMLInputElement>(null);
  // Tracks whether the *previous* status was "shared", so the transition
  // into "shared" (a real new/updated link) fires `canvas_shared` exactly
  // once per successful share, not on every render while shared.
  const wasShared = useRef(status === "shared");

  useEffect(() => {
    if (status === "shared" && !wasShared.current) {
      track("canvas_shared", {});
    }
    wasShared.current = status === "shared";
  }, [status]);

  const handleShare = () => {
    void useShareStore.getState().share();
  };

  const handleUnshare = async () => {
    await useShareStore.getState().unshare();
    // An offline click or a server error leaves the canvas still shared —
    // only record the event once the store confirms the unshare actually
    // landed (status back to "idle"), not unconditionally on every click.
    if (useShareStore.getState().status === "idle") {
      track("canvas_unshared", {});
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast("Link copied");
    } catch {
      // Clipboard API unavailable/denied — select the text so the user can
      // still copy it with a manual Cmd/Ctrl+C.
      urlInputRef.current?.select();
    }
  };

  const isSharing = status === "sharing";
  const isShared = status === "shared" && !!shareUrl;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md" aria-describedby="share-dialog-description">
        <DialogHeader>
          <DialogTitle>Share this canvas</DialogTitle>
          <DialogDescription id="share-dialog-description">
            Anyone with the link can view this canvas and make their own
            copy. They can't edit yours.
          </DialogDescription>
        </DialogHeader>

        {isShared ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <input
                ref={urlInputRef}
                readOnly
                value={shareUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 min-w-0 h-7 px-2 rounded-md border border-border-default bg-secondary text-xs text-text-default outline-none"
                aria-label="Share link"
              />
              <Button size="sm" variant="secondary" onClick={() => void handleCopy()}>
                Copy link
              </Button>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button size="sm" variant="outline" onClick={handleShare} disabled={isSharing}>
                {isSharing ? "Updating…" : "Update"}
              </Button>
              <Button size="sm" variant="destructive" onClick={() => void handleUnshare()} disabled={isSharing}>
                Stop sharing
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {status === "error" && error && (
              <p className="text-xs text-destructive">{error}</p>
            )}
            <div className="flex justify-end">
              <Button size="sm" onClick={handleShare} disabled={isSharing}>
                {isSharing ? "Sharing…" : "Share"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
