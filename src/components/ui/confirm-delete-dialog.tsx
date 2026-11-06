import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ConfirmDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shown in the title: Delete “name”? */
  name: string;
  onConfirm: () => void;
  /** Replaces the whole title (then `name` is unused). */
  title?: string;
  /** Replaces "This cannot be undone." */
  description?: string;
}

/** The "Delete “name”? This cannot be undone." confirmation shared by the document and workflow pages. */
export function ConfirmDeleteDialog({ open, onOpenChange, name, onConfirm, title, description }: ConfirmDeleteDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{title ?? `Delete “${name}”?`}</AlertDialogTitle>
          <AlertDialogDescription>{description ?? "This cannot be undone."}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
