import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ShowcaseScreen } from "@/lib/showcase";

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function ShowcaseLightbox({
  screen,
  onOpenChange,
}: {
  screen: ShowcaseScreen | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={screen != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-fit p-4 sm:max-w-fit">
        <DialogHeader>
          <DialogTitle>{screen?.title ?? ""}</DialogTitle>
          <DialogDescription>
            {screen && (
              <>
                {screen.theme} · {screen.model} · {formatDate(screen.createdAt)}
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        {screen && (
          <div className="overflow-hidden rounded-lg ring-1 ring-border-default">
            {/* Live HTML render of the generated screen. `allow-scripts` only —
                NEVER add `allow-same-origin` alongside it: together they lift the
                sandbox entirely, and this markup was produced by an LLM. */}
            <iframe
              key={screen.id}
              src={screen.htmlUrl}
              sandbox="allow-scripts"
              // Without this the gallery URL is sent as Referer to the bucket
              // serving LLM-authored markup — no reason to hand it over.
              referrerPolicy="no-referrer"
              title={screen.title}
              width={screen.width}
              height={screen.height}
              style={{ width: screen.width, height: screen.height, maxWidth: "100%" }}
              className="block border-0"
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
